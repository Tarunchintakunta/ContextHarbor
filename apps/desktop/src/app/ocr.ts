// OCR of the meeting window (shared content and chat panel) using the OS engine where available.
// macOS: Vision (compiled once with swiftc). Windows: Windows.Media.Ocr via PowerShell. Linux: tesseract.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const VISION_SWIFT = `
import Foundation
import Vision
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { exit(2) }
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = true
try VNImageRequestHandler(cgImage: img).perform([req])
let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\\n"))
`;

const WIN_PS = `
param([string]$p)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
function Await($t,$r){$m=[System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'}|select -First 1;$m.MakeGenericMethod($r).Invoke($null,@($t)).Result}
$f=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
$s=Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$d=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])
$b=Await ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$r=Await ([Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages().RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult])
$r.Lines|%{$_.Text}
`;

export class Ocr {
  private lastHash = "";
  constructor(private workDir: string) {
    mkdirSync(workDir, { recursive: true, mode: 0o700 });
  }

  /** Returns OCR text, or null when the frame is unchanged since the last call. */
  async read(png: Buffer): Promise<string | null> {
    const hash = createHash("sha1").update(png).digest("hex");
    if (hash === this.lastHash) return null;
    this.lastHash = hash;
    const file = path.join(this.workDir, "frame.png");
    writeFileSync(file, png, { mode: 0o600 });
    try {
      if (process.platform === "darwin") return await run(await this.visionBinary(), [file]);
      if (process.platform === "win32") {
        const ps = path.join(this.workDir, "ocr.ps1");
        if (!existsSync(ps)) writeFileSync(ps, WIN_PS);
        return await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps, file]);
      }
      return await run("tesseract", [file, "-", "-l", "eng"]);
    } finally {
      rmSync(file, { force: true }); // no screen frames kept
    }
  }

  private async visionBinary() {
    const bin = path.join(this.workDir, "vision-ocr");
    if (!existsSync(bin)) {
      const src = path.join(this.workDir, "vision-ocr.swift");
      writeFileSync(src, VISION_SWIFT);
      await run("swiftc", ["-O", "-o", bin, src], 120_000);
    }
    return bin;
  }
}

function run(cmd: string, args: string[], timeout = 15_000) {
  return new Promise<string>((res, rej) =>
    execFile(cmd, args, { timeout, maxBuffer: 2_000_000 }, (e, out) => (e ? rej(e) : res(out.trim()))),
  );
}
