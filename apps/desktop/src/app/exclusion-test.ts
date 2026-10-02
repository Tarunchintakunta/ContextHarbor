// Capture-exclusion test: a protected magenta window (setContentProtection) next to an unprotected green control,
// then a real OS-level screenshot. PASS = control visible AND protected window absent. Writes JSON + PNG evidence.
// Run: electron dist/app/exclusion-test.js <outPrefix>
import { app, BrowserWindow, nativeImage, screen } from "electron";
import { execFile } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const out = process.argv.at(-1)!.endsWith(".js") ? path.join(process.cwd(), "exclusion") : process.argv.at(-1)!;

function solid(color: string, x: number, y: number, protect: boolean) {
  const w = new BrowserWindow({ x, y, width: 240, height: 160, frame: false, show: false, alwaysOnTop: true, focusable: false, webPreferences: { sandbox: true } });
  w.setContentProtection(protect);
  void w.loadURL(`data:text/html,<body style="margin:0;background:${color}"></body>`);
  return w;
}

function grab(file: string, region: { x: number; y: number; width: number; height: number }) {
  const r = `${region.x},${region.y},${region.width},${region.height}`;
  const [cmd, args] =
    process.platform === "darwin" ? ["screencapture", ["-x", "-R", r, file]]
    : process.platform === "win32" ? ["powershell", ["-NoProfile", "-Command",
        `Add-Type -AssemblyName System.Drawing; $b=New-Object Drawing.Bitmap ${region.width},${region.height}; $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${region.x},${region.y},0,0,$b.Size); $b.Save('${file}')`]]
    : ["import", ["-window", "root", "-crop", `${region.width}x${region.height}+${region.x}+${region.y}`, file]];
  return new Promise<void>((res, rej) => execFile(cmd, args as string[], { timeout: 20_000 }, (e) => (e ? rej(e) : res())));
}

function share(img: Electron.NativeImage, rgb: [number, number, number]) {
  const { width, height } = img.getSize();
  const bmp = img.toBitmap(); // BGRA
  let hit = 0;
  for (let i = 0; i < width * height; i++) {
    const b = bmp[i * 4], g = bmp[i * 4 + 1], r = bmp[i * 4 + 2];
    if (Math.abs(r - rgb[0]) < 40 && Math.abs(g - rgb[1]) < 40 && Math.abs(b - rgb[2]) < 40) hit++;
  }
  return hit / (width * height);
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay().workArea;
  const x = d.x + 80, y = d.y + 120;
  const prot = solid("#ff00ff", x, y, true);
  const ctrl = solid("#00ff00", x + 300, y, false);
  await new Promise((r) => setTimeout(r, 1200));
  prot.showInactive();
  ctrl.showInactive();
  await new Promise((r) => setTimeout(r, 1500));
  const file = `${out}.png`;
  let error: string | null = null;
  try {
    await grab(file, { x, y, width: 540, height: 160 });
  } catch (e) {
    error = String(e).slice(0, 200);
  }
  let result: Record<string, unknown> = { platform: process.platform, osRelease: os.release(), electron: process.versions.electron, method: process.platform === "darwin" ? "screencapture" : process.platform === "win32" ? "GDI CopyFromScreen" : "ImageMagick import", error };
  if (!error) {
    const img = nativeImage.createFromBuffer(readFileSync(file));
    const { width } = img.getSize();
    const scale = width / 540;
    const left = img.crop({ x: Math.round(20 * scale), y: Math.round(20 * scale), width: Math.round(200 * scale), height: Math.round(120 * scale) });
    const right = img.crop({ x: Math.round(320 * scale), y: Math.round(20 * scale), width: Math.round(200 * scale), height: Math.round(120 * scale) });
    const protectedVisible = share(left, [255, 0, 255]);
    const controlVisible = share(right, [0, 255, 0]);
    const valid = controlVisible > 0.8; // otherwise the screenshot didn't see app windows (e.g. missing permission)
    result = { ...result, controlVisible, protectedVisible, valid, verdict: !valid ? "INCONCLUSIVE (capture did not include windows)" : protectedVisible < 0.05 ? "PASS (excluded)" : "FAIL (protected window captured)" };
  } else rmSync(file, { force: true });
  writeFileSync(`${out}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.exit(0);
});
