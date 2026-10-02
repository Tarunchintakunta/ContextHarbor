// Packages the app for the current OS. macOS: adds audio/mic/screen usage strings and ad-hoc signs (not notarized).
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";

const out = await packager({
  dir: ".",
  out: "out",
  overwrite: true,
  asar: { unpackDir: "models" }, // whisper-cli is an external process and cannot read inside app.asar
  prune: false, // no runtime dependencies; pnpm symlinks confuse the pruner
  electronVersion: "44.5.1",
  name: "ContextHarbor",
  appBundleId: "dev.contextharbor.desktop",
  ignore: [/^\/node_modules/, /^\/src/, /^\/out/, /^\/demo/, /^\/scripts/, /\.test\.js$/, /^\/dist\/(harness|eval)/],
  extendInfo: {
    LSUIElement: true,
    NSAudioCaptureUsageDescription: "ContextHarbor transcribes the meeting audio on this computer to answer questions aimed at you.",
    NSMicrophoneUsageDescription: "ContextHarbor transcribes your own voice so it knows what you already said.",
    NSScreenCaptureUsageDescription: "ContextHarbor reads meeting window titles and shared slides (OCR) to understand the meeting.",
  },
});
if (process.platform === "darwin") {
  for (const app of out) execFileSync("codesign", ["--force", "--deep", "-s", "-", `${app}/ContextHarbor.app`], { stdio: "inherit" });
}
console.log(out.join("\n"));
