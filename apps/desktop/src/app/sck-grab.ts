// Separate process that captures the whole screen through Chromium's desktop capturer (ScreenCaptureKit on macOS),
// the same path browser-based meeting apps use for screen sharing. Usage: electron dist/app/sck-grab.js <out.png> x y w h
import { app, desktopCapturer, screen } from "electron";
import { writeFileSync } from "node:fs";

app.whenReady().then(async () => {
  const [out, x, y, w, h] = process.argv.slice(-5);
  const d = screen.getPrimaryDisplay();
  const sf = d.scaleFactor;
  const [src] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: d.size.width * sf, height: d.size.height * sf } });
  const crop = src.thumbnail.crop({ x: Number(x) * sf, y: Number(y) * sf, width: Number(w) * sf, height: Number(h) * sf });
  writeFileSync(out, crop.toPNG());
  app.exit(0);
});
