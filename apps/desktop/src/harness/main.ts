// ContextHarbor desktop feasibility harness (T02).
// Overlay window that never takes focus, tray status, show/hide, pause, quit.
// Content is a generated nonconfidential marker; no client data is loaded here.
import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, Tray, Menu } from "electron";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type Command = "toggle-visible" | "toggle-pause" | "quit";
const COMMANDS: ReadonlySet<string> = new Set<Command>(["toggle-visible", "toggle-pause", "quit"]);

const state = {
  marker: `CH-MARKER-${randomBytes(3).toString("hex").toUpperCase()}`,
  visible: false,
  paused: false,
  // Audio capture arrives in T03/T04; the harness reports it honestly as not started.
  capture: "not-started" as "not-started" | "listening" | "paused",
  contentProtection: "requested-unverified",
};

let overlay: BrowserWindow | null = null;
let tray: Tray | null = null;
const shortcuts: string[] = [];
const released: string[] = [];

function pushState() {
  overlay?.webContents.send("state", state);
  if (tray) {
    tray.setToolTip(`ContextHarbor harness — ${state.paused ? "paused" : "active"}, overlay ${state.visible ? "shown" : "hidden"}`);
    if (process.platform === "darwin") tray.setTitle(state.paused ? "CH ❚❚" : "CH ●");
    tray.setContextMenu(buildMenu());
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: state.marker, enabled: false },
    { label: state.visible ? "Hide overlay" : "Show overlay", click: () => run("toggle-visible") },
    { label: state.paused ? "Resume" : "Pause", click: () => run("toggle-pause") },
    { type: "separator" },
    { label: "Quit (stops everything)", click: () => run("quit") },
  ]);
}

function run(cmd: Command) {
  if (cmd === "toggle-visible") {
    if (!overlay) return;
    // showInactive keeps the presenter's current app frontmost.
    if (state.visible) overlay.hide();
    else overlay.showInactive();
    state.visible = !state.visible;
  } else if (cmd === "toggle-pause") {
    // Hiding never implies pausing; they are independent controls (PRD journey step 8).
    state.paused = !state.paused;
  } else if (cmd === "quit") {
    app.quit();
    return;
  }
  pushState();
}

function trayIcon() {
  // 16x16 solid BGRA square; avoids shipping an asset in the harness.
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) buf.set([0xc0, 0x80, 0x20, 0xff], i * 4);
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: 420,
    height: 300,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    // macOS non-activating panel: clicks do not activate the app.
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.setAlwaysOnTop(true, "floating");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Best effort only; receiver-side behavior must be verified (T03/T04/T41).
  overlay.setContentProtection(true);
  overlay.webContents.on("will-navigate", (e) => e.preventDefault());
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlay.loadFile(path.join(__dirname, "..", "..", "static", "harness.html"));
  overlay.webContents.on("did-finish-load", pushState);
}

ipcMain.on("command", (event, cmd: unknown) => {
  if (!overlay || event.sender !== overlay.webContents) return;
  if (typeof cmd === "string" && COMMANDS.has(cmd)) run(cmd as Command);
});

function registerShortcuts() {
  const map: Record<string, Command> = {
    "CommandOrControl+Alt+H": "toggle-visible",
    "CommandOrControl+Alt+P": "toggle-pause",
    "CommandOrControl+Alt+Q": "quit",
  };
  for (const [accel, cmd] of Object.entries(map)) {
    if (globalShortcut.register(accel, () => run(cmd))) shortcuts.push(accel);
    else console.warn(`shortcut unavailable: ${accel}`);
  }
}

function releaseAll() {
  for (const s of shortcuts) globalShortcut.unregister(s);
  released.push(`shortcuts:${shortcuts.length}`);
  shortcuts.length = 0;
  tray?.destroy();
  tray = null;
  released.push("tray");
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
  released.push("overlay");
  state.capture = "not-started";
  released.push("capture:none-acquired");
}

async function selftest() {
  const out = process.env.CH_EVIDENCE_DIR ?? path.join(process.cwd(), "evidence");
  mkdirSync(out, { recursive: true });
  const checks: Record<string, boolean | string> = {};
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  run("toggle-visible");
  await wait(800);
  checks.shownAfterToggle = overlay!.isVisible();
  checks.overlayNotFocused = !overlay!.isFocused();
  checks.noFocusedAppWindow = BrowserWindow.getFocusedWindow() === null;
  checks.overlayNotFocusable = !overlay!.isFocusable();
  const png = await overlay!.webContents.capturePage();
  writeFileSync(path.join(out, "t02-overlay.png"), png.toPNG());
  run("toggle-pause");
  checks.pausedIndependentOfVisibility = state.paused && overlay!.isVisible();
  run("toggle-visible");
  await wait(300);
  checks.hiddenAfterToggle = !overlay!.isVisible();
  checks.hideDidNotChangePause = state.paused;
  checks.shortcutsRegistered = shortcuts.length === 3;
  checks.marker = state.marker;
  if (process.env.CH_CLICKTEST === "1") {
    // Leave the overlay at a fixed spot so an OS-level click can hit the Pause button.
    overlay!.setPosition(100, 100);
    run("toggle-visible");
    const pausedBefore = state.paused;
    await wait(6000);
    checks.osClickToggledPause = state.paused !== pausedBefore;
    checks.overlayNotFocusedAfterClick = !overlay!.isFocused();
  }
  app.once("will-quit", () => {
    checks.released = released.join(",");
    checks.shortcutsUnregistered = !["CommandOrControl+Alt+H", "CommandOrControl+Alt+P", "CommandOrControl+Alt+Q"].some((a) =>
      globalShortcut.isRegistered(a),
    );
    writeFileSync(path.join(out, "t02-selftest.json"), JSON.stringify(checks, null, 2));
  });
  app.quit();
}

app.whenReady().then(() => {
  // Accessory app on macOS: no Dock icon, never becomes the active presentation app.
  if (process.platform === "darwin") app.dock?.hide();
  tray = new Tray(trayIcon());
  createOverlay();
  registerShortcuts();
  pushState();
  if (process.env.CH_SELFTEST === "1") overlay!.webContents.once("did-finish-load", () => void selftest());
});

app.on("before-quit", releaseAll);
// Closing the overlay never quits silently; the tray menu owns Quit.
app.on("window-all-closed", () => {});
