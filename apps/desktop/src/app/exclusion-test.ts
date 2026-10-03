// Capture-exclusion test: a protected magenta window (setContentProtection) next to an unprotected green control,
// then a real OS-level screenshot. PASS = control visible AND protected window absent. Writes JSON + PNG evidence.
// Run: electron dist/app/exclusion-test.js <outPrefix>
import { app, BrowserWindow, nativeImage, screen } from "electron";
import { execFile } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const out = process.argv.at(-1)!.endsWith(".js") ? path.join(process.cwd(), "exclusion") : process.argv.at(-1)!;

async function solid(color: string, x: number, y: number, protect: boolean) {
  const w = new BrowserWindow({ x, y, width: 240, height: 160, frame: false, show: false, backgroundColor: color, alwaysOnTop: true, focusable: false, hasShadow: false, webPreferences: { sandbox: true } });
  w.setContentProtection(protect);
  w.setAlwaysOnTop(true, "screen-saver");
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const ready = new Promise<void>((r) => w.once("ready-to-show", () => r()));
  await w.loadURL(`data:text/html,<body style="margin:0;background:${color}"></body>`);
  await ready;
  w.showInactive();
  w.setBounds({ x, y, width: 240, height: 160 });
  return w;
}

const METHOD = process.env.CH_CAPTURE_METHOD ?? "os"; // "os" = screencapture/GDI/import, "sck" = Chromium capturer in another process

function grab(file: string, region: { x: number; y: number; width: number; height: number }) {
  if (METHOD === "sck") {
    return new Promise<void>((res, rej) =>
      execFile(process.execPath, [path.join(__dirname, "sck-grab.js"), file, String(region.x), String(region.y), String(region.width), String(region.height)], { timeout: 30_000 }, (e) => (e ? rej(e) : res())));
  }
  const r = `${region.x},${region.y},${region.width},${region.height}`;
  const [cmd, args] =
    process.platform === "darwin" ? ["screencapture", ["-x", "-R", r, file]]
    : process.platform === "win32" ? ["powershell", ["-NoProfile", "-Command",
        `Add-Type -AssemblyName System.Drawing; $b=New-Object Drawing.Bitmap ${region.width},${region.height}; $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${region.x},${region.y},0,0,$b.Size); $b.Save('${file}')`]]
    : ["import", ["-window", "root", "-crop", `${region.width}x${region.height}+${region.x}+${region.y}`, file]];
  return new Promise<void>((res, rej) => execFile(cmd, args as string[], { timeout: 20_000 }, (e) => (e ? rej(e) : res())));
}

// Hue-based match: capture paths may color-manage (sRGB -> display profile), so exact RGB is unreliable.
const IS = {
  green: (r: number, g: number, b: number) => g > 180 && g - r > 80 && g - b > 80,
  magenta: (r: number, g: number, b: number) => r > 180 && b > 180 && r - g > 80 && b - g > 80,
};
function share(img: Electron.NativeImage, kind: keyof typeof IS) {
  const { width, height } = img.getSize();
  const bmp = img.toBitmap(); // BGRA
  let hit = 0;
  for (let i = 0; i < width * height; i++) if (IS[kind](bmp[i * 4 + 2], bmp[i * 4 + 1], bmp[i * 4])) hit++;
  return hit / (width * height);
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay().workArea;
  const x = d.x + 80, y = d.y + 120;
  const prot = await solid("#ff00ff", x, y, true);
  const ctrl = await solid("#00ff00", x + 300, y, false);
  await new Promise((r) => setTimeout(r, 1500));
  console.error(`bounds prot=${JSON.stringify(prot.getBounds())} visible=${prot.isVisible()} ctrl=${JSON.stringify(ctrl.getBounds())} visible=${ctrl.isVisible()} display=${JSON.stringify(d)}`);
  const file = `${out}.png`;
  let error: string | null = null;
  try {
    await grab(file, { x, y, width: 540, height: 160 });
  } catch (e) {
    error = String(e).slice(0, 200);
  }
  let result: Record<string, unknown> = { platform: process.platform, osRelease: os.release(), electron: process.versions.electron, method: METHOD === "sck" ? "Chromium desktopCapturer (ScreenCaptureKit) in a separate process" : process.platform === "darwin" ? "screencapture" : process.platform === "win32" ? "GDI CopyFromScreen" : "ImageMagick import", error };
  if (!error) {
    const img = nativeImage.createFromBuffer(readFileSync(file));
    const { width } = img.getSize();
    const scale = width / 540;
    const left = img.crop({ x: Math.round(20 * scale), y: Math.round(20 * scale), width: Math.round(200 * scale), height: Math.round(120 * scale) });
    const right = img.crop({ x: Math.round(320 * scale), y: Math.round(20 * scale), width: Math.round(200 * scale), height: Math.round(120 * scale) });
    const protectedVisible = share(left, "magenta");
    const controlVisible = share(right, "green");
    const valid = controlVisible > 0.8; // otherwise the screenshot didn't see app windows (e.g. missing permission)
    result = { ...result, controlVisible, protectedVisible, valid, verdict: !valid ? "INCONCLUSIVE (capture did not include windows)" : protectedVisible < 0.05 ? "PASS (excluded)" : "FAIL (protected window captured)" };
  } else rmSync(file, { force: true });
  writeFileSync(`${out}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.exit(0);
});
