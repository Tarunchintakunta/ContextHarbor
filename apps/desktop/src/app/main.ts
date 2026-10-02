// ContextHarbor daily assistant: background process, meeting detection, live context, RAG answers, private overlay.
import {
  app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, session, shell, systemPreferences, Tray,
} from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LiveContextBuffer, type LiveItem } from "../core/live";
import { detectDirected, isQuestion } from "../core/question";
import { decidePolicy, type PolicyDecision } from "../core/store";
import { meetingFolder } from "../core/memory";
import { weekOf } from "../core/weeks";
import { NOTHING } from "../core/prompt";
import { classify, processList, type Detection } from "./detect";
import { Ocr } from "./ocr";
import { choosePlacement } from "./placement";
import { applyPatch, defaults, SettingsFile, type Settings } from "./settings";
import { RATE, VadSegmenter, WhisperCli, type Segment } from "./stt";
import { UserContext } from "./userctx";
import type { AnswerPipeline as AnswerPipelineT } from "../core/pipeline";

const APP_DIR = path.join(__dirname, "..", "..");
const STATIC = path.join(APP_DIR, "static");
const DEMO_AUDIO = process.env.CH_DEMO_AUDIO; // simulated remote audio (WAV) for demos/tests; labeled in UI
const DEMO_MEETING = process.env.CH_DEMO_MEETING; // forces a detected meeting with this title

if (process.env.CH_USER_DATA) app.setPath("userData", process.env.CH_USER_DATA); // isolated profile for tests/demos
if (!app.requestSingleInstanceLock()) app.exit(0);

let settings: Settings;
let settingsFile: SettingsFile;
let ctx: UserContext | null = null;
let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let capture: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let stt: WhisperCli | null = null;
let ocr: Ocr | null = null;

const state = {
  paused: false,
  listening: false,
  meeting: null as null | { live: LiveContextBuffer; policy: PolicyDecision; detection: Detection; consented: boolean },
  lastDetection: null as Detection | null,
  misses: 0,
  pinned: false,
  answering: 0, // generation counter; late results from older generations are dropped
  status: "idle",
  captureMode: "none" as "none" | "loopback" | "simulated",
};
const segmenters = new Map<string, VadSegmenter>();
const logs: Record<string, unknown>[] = [];
let hideTimer: NodeJS.Timeout | null = null;

// ---------- logging: metadata only, encrypted on flush ----------
function log(e: Record<string, unknown>) {
  logs.push({ t: Date.now(), ...e });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
}
function flushLogs() {
  if (!ctx || !logs.length) return;
  const prev = ctx.vault.files.read("logs") ?? "";
  const lines = (prev + logs.map((l) => JSON.stringify(l)).join("\n") + "\n").split("\n").slice(-5000).join("\n");
  ctx.vault.files.write("logs", lines);
  logs.length = 0;
}

// ---------- user context ----------
const keyWrap = {
  encrypt: (b: Buffer) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(b.toString("base64")) : Buffer.concat([Buffer.from("PLAIN:"), b])),
  decrypt: (b: Buffer) => (b.subarray(0, 6).toString() === "PLAIN:" ? b.subarray(6) : Buffer.from(safeStorage.decryptString(b), "base64")),
};

function apiKey(ref?: string) {
  if (!ref) return "";
  try {
    const f = path.join(app.getPath("userData"), "keys", `${ref}.bin`);
    return safeStorage.decryptString(readFileSync(f));
  } catch {
    return "";
  }
}

async function switchUser(userId: string) {
  // Full reset before anything else (Part 2, Section 4).
  await endMeeting("user switch", true);
  state.answering++;
  ctx?.dispose();
  ctx = null;
  segmenters.clear();
  overlay?.webContents.send("overlay", { kind: "clear" });
  overlay?.hide();
  settings = { ...settings, userId };
  if (!settings.users.includes(userId)) settings.users.push(userId);
  settingsFile.save(settings);
  ctx = new UserContext(userId, app.getPath("userData"), settings, keyWrap, log, apiKey);
  await ctx.init();
  if (stt) stt.vocabulary = vocabulary();
  log({ ev: "user_active", embedder: ctx.embedderId });
  void finalizePending(ctx);
  refresh();
}

function vocabulary() {
  return [...settings.profile.names, ...settings.profile.roles, ...settings.profile.ownedTopics].join(", ");
}

// ---------- meeting lifecycle ----------
async function pollMeeting() {
  if (!ctx) return;
  let det: Detection;
  if (DEMO_MEETING) {
    det = { active: true, app: "Demo", title: DEMO_MEETING, windowId: null, sharing: false, signals: ["demo"] };
  } else {
    const [procs, windows] = await Promise.all([
      processList(),
      desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } }).then((s) => s.map((w) => ({ id: w.id, title: w.name }))).catch(() => []),
    ]);
    det = classify(procs, windows, state.listening && lastAudioLevel > 0.01);
  }
  state.lastDetection = det;
  if (det.active && !state.meeting) await startMeeting(det);
  else if (!det.active && state.meeting) {
    if (++state.misses >= 2) await endMeeting("meeting ended");
  } else state.misses = 0;
  if (state.meeting) state.meeting.detection = det;
  refresh();
}

async function startMeeting(det: Detection) {
  const title = det.title?.replace(/\s*[-–|]\s*(Google Chrome|Microsoft Edge|Safari|Firefox|Arc|Brave)$/i, "").slice(0, 120) || `${det.app} meeting`;
  const policy = decidePolicy(settings.policy, { title, participantsConsented: false });
  log({ ev: "meeting_start", app: det.app, persist: policy.persist, assist: policy.assist });
  if (!policy.assist) {
    state.status = "off for this meeting";
    return;
  }
  const live = new LiveContextBuffer({ id: `${Date.now()}`, title, app: det.app ?? "unknown", startedAt: Date.now(), participants: [] });
  live.add({ t: Date.now(), kind: "meta", text: `Meeting: ${title} (${det.app})` });
  state.meeting = { live, policy, detection: det, consented: false };
  state.misses = 0;
  // Warm the pinned model so the first answer is not a cold load (local models unload when idle).
  const first = ctx?.models[0];
  if (first) void first.generate({ system: "Reply OK.", messages: [{ role: "user", content: "ping" }], maxTokens: 2, timeoutMs: 60_000 }).catch(() => {});
  if (!state.paused) startListening();
}

async function endMeeting(reason: string, discard = false) {
  const m = state.meeting;
  if (!m) return;
  stopListening();
  state.meeting = null;
  log({ ev: "meeting_end", reason, items: m.live.items.length });
  if (discard || !m.policy.persist || !ctx) return; // not permitted: nothing saved
  const c = ctx;
  const folder = meetingFolder(m.live.meta);
  c.vault.saveMeeting({ id: m.live.meta.id, title: m.live.meta.title, startedAt: m.live.meta.startedAt, endedAt: Date.now(), folder, transcript: m.live.toMarkdown() });
  if (reason === "quit") {
    c.vault.files.write(`pending/${m.live.meta.id}`, JSON.stringify({ meta: m.live.meta, items: m.live.items })); // summarized on next launch
    return;
  }
  void c.memory.finalize(m.live).catch((e) => log({ ev: "finalize_error", err: String(e).slice(0, 80) })); // background
}

/** Summarizes meetings that ended while the app was quitting. */
async function finalizePending(c: UserContext) {
  for (const name of c.vault.files.list("pending")) {
    const p = JSON.parse(c.vault.files.read(name)!) as { meta: LiveContextBuffer["meta"]; items: LiveItem[] };
    const live = new LiveContextBuffer(p.meta);
    for (const i of p.items) live.add(i);
    await c.memory.finalize(live).catch((e) => log({ ev: "finalize_error", err: String(e).slice(0, 80) }));
    c.vault.files.remove(name);
  }
}

function currentPolicy(): PolicyDecision | null {
  const m = state.meeting;
  if (!m) return null;
  return decidePolicy(settings.policy, { title: m.live.meta.title, participantsConsented: m.consented });
}

// ---------- capture ----------
let lastAudioLevel = 0;

function startListening() {
  if (state.listening || !state.meeting) return;
  state.listening = true;
  segmenters.set("remote", new VadSegmenter("remote", onSegment));
  segmenters.set("me", new VadSegmenter("me", onSegment));
  if (DEMO_AUDIO) {
    state.captureMode = "simulated";
    void feedDemoAudio(DEMO_AUDIO);
  } else {
    state.captureMode = "loopback";
    capture?.webContents.send("capture", { cmd: "start" });
  }
  ocrLoop();
  refresh();
}

function stopListening() {
  if (!state.listening) return;
  state.listening = false;
  capture?.webContents.send("capture", { cmd: "stop" });
  for (const s of segmenters.values()) s.flush();
  segmenters.clear();
  state.captureMode = "none";
  refresh();
}

ipcMain.on("capture:frame", (e, channel: unknown, buf: unknown) => {
  if (e.sender !== capture?.webContents || !state.listening || state.paused) return;
  if ((channel !== "remote" && channel !== "me") || !(buf instanceof ArrayBuffer) || buf.byteLength > RATE) return;
  const frame = new Int16Array(buf);
  if (channel === "remote") lastAudioLevel = Math.sqrt(frame.reduce((s, x) => s + x * x, 0) / Math.max(1, frame.length)) / 32768;
  segmenters.get(channel)?.push(frame);
});
ipcMain.on("capture:status", (e, s: unknown) => {
  if (e.sender !== capture?.webContents || typeof s !== "string") return;
  log({ ev: "capture_status", s: s.slice(0, 60) });
  if (s.startsWith("error")) state.status = "audio unavailable";
  refresh();
});

async function feedDemoAudio(file: string) {
  const data = readFileSync(file);
  const pcm = new Int16Array(data.buffer, data.byteOffset + 44, (data.length - 44) / 2);
  const step = RATE / 10;
  for (let i = 0; i < pcm.length && state.listening; i += step) {
    segmenters.get("remote")?.push(pcm.slice(i, i + step));
    await new Promise((r) => setTimeout(r, 100)); // real time
  }
  for (let i = 0; i < 10 && state.listening; i++) {
    segmenters.get("remote")?.push(new Int16Array(step));
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function onSegment(seg: Segment) {
  const m = state.meeting;
  if (!stt || !m) return;
  const gen = state.answering;
  const text = await stt.transcribe(seg).catch((e) => (log({ ev: "stt_error", err: String(e).slice(0, 60) }), null));
  if (!text || state.meeting !== m) return; // dropped, empty, or meeting/user changed meanwhile
  const prev = [...m.live.items].reverse().find((i) => i.kind === "speech");
  const item: LiveItem = { t: seg.startedAt, kind: "speech", speaker: seg.channel, text };
  m.live.add(item);
  log({ ev: "utterance", channel: seg.channel, chars: text.length });
  overlay?.webContents.send("overlay", { kind: "heard", text: seg.channel === "remote" ? text : "" });
  if (seg.channel !== "remote" || state.paused) return;
  const v = detectDirected({ speaker: "remote", text }, { profile: settings.profile, previous: prev ? { speaker: prev.speaker ?? "remote", text: prev.text } : undefined, participantCount: m.live.meta.participants.length || undefined });
  log({ ev: "question_check", directed: v.directed, reason: v.reason });
  if (v.directed && gen === state.answering) void answer(text, "Remote speaker");
}

function ocrLoop() {
  if (!state.listening || !ocr) return;
  const m = state.meeting!;
  const wid = m.detection.windowId;
  const go = async () => {
    if (!state.listening || state.meeting !== m || !wid || state.paused) return;
    const src = (await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1600, height: 1000 } }).catch(() => [])).find((s) => s.id === wid);
    if (!src || src.thumbnail.isEmpty()) return;
    const text = await ocr!.read(src.thumbnail.toPNG()).catch(() => null);
    if (text && state.meeting === m) m.live.add({ t: Date.now(), kind: "screen", text: text.slice(0, 4000) });
  };
  const timer = setInterval(() => {
    if (!state.listening || state.meeting !== m) return clearInterval(timer);
    void go();
  }, 10_000);
}

// ---------- answering ----------
async function answer(question: string, askedBy: string) {
  const m = state.meeting;
  const c = ctx;
  if (!m || !c) return;
  const gen = ++state.answering;
  const send = (payload: Record<string, unknown>) => {
    if (gen === state.answering && ctx === c) overlay?.webContents.send("overlay", payload);
  };
  if (!placeOverlay()) {
    log({ ev: "answer_suppressed", reason: "no safe display" });
    return;
  }
  send({ kind: "question", text: question, workspace: c.userId });
  showOverlay();
  const series = c.memory.seriesSummary(m.live.meta.title);
  const rollup = c.memory.rollupFor(new Date().toISOString().slice(0, 10));
  const a = await c.pipeline.answer(question, askedBy, m.live, { seriesSummary: series, rollupSummary: rollup }, {
    onDelta: (d) => send({ kind: "delta", text: d }),
    onStatus: (s) => send({ kind: "status", text: s }),
  });
  if (gen !== state.answering || ctx !== c) return; // superseded or user switched: drop late result
  send({ kind: "final", text: a.text, status: a.status, model: a.modelId, ms: a.timings.totalMs });
  log({ ev: "answer_shown", status: a.status, ms: a.timings.totalMs, model: a.modelId, tokens: a.requestTokens });
  if (currentPolicy()?.persist) c.vault.addHistory({ t: Date.now(), meetingId: m.live.meta.id, question, answer: a.text, status: a.status });
  scheduleHide();
  if (process.env.CH_E2E_OUT) void e2eReport(question, a);
}

async function e2eReport(question: string, a: Awaited<ReturnType<AnswerPipelineT["answer"]>>) {
  const out = process.env.CH_E2E_OUT!;
  await new Promise((r) => setTimeout(r, 600));
  const png = await overlay!.webContents.capturePage();
  writeFileSync(`${out}.png`, png.toPNG());
  writeFileSync(`${out}.json`, JSON.stringify({
    question, answer: a.text, status: a.status, model: a.modelId, timings: a.timings, requestTokens: a.requestTokens, attempts: a.attempts,
    sources: a.sources, overlay: { visible: overlay!.isVisible(), focused: overlay!.isFocused(), contentProtection: true, bounds: overlay!.getBounds() },
    captureMode: state.captureMode, meeting: state.meeting?.live.meta.title, liveItems: state.meeting?.live.items.map((i) => ({ kind: i.kind, speaker: i.speaker, text: i.text })),
  }, null, 2));
  setTimeout(() => app.quit(), 300);
  setTimeout(() => app.exit(0), 5000); // test runs must never hang
}

function manualAsk() {
  const m = state.meeting;
  if (!m) {
    overlay?.webContents.send("overlay", { kind: "final", text: "No active meeting.", status: "unavailable" });
    if (placeOverlay()) showOverlay();
    scheduleHide();
    return;
  }
  const recent = [...m.live.items].reverse().filter((i) => i.kind === "speech" && i.speaker !== "me");
  const q = recent.find((i) => isQuestion(i.text)) ?? recent[0];
  if (q) void answer(q.text, "Remote speaker");
  else {
    overlay?.webContents.send("overlay", { kind: "final", text: NOTHING, status: "nothing" });
    if (placeOverlay()) showOverlay();
    scheduleHide();
  }
}

// ---------- overlay ----------
function createOverlay() {
  overlay = new BrowserWindow({
    width: 420, height: 260, show: false, frame: false, transparent: true, resizable: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false,
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: { preload: path.join(__dirname, "preload-overlay.js"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  overlay.setContentProtection(true); // macOS sharingType none / Windows WDA_EXCLUDEFROMCAPTURE
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setOpacity(0.94);
  lockDown(overlay);
  void overlay.loadFile(path.join(STATIC, "overlay.html"));
}

function placeOverlay(): boolean {
  if (!overlay) return false;
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const p = choosePlacement({
    platform: process.platform, osRelease: os.release(),
    displays: displays.map((d) => ({ id: d.id, primary: d.id === primaryId, bounds: d.workArea })),
    sharing: state.lastDetection?.sharing ?? false,
    mode: settings.display.mode, displayId: settings.display.displayId, trustCaptureExclusion: settings.display.trustCaptureExclusion,
  });
  log({ ev: "placement", show: p.show, reason: p.reason });
  if (!p.show) {
    overlay.hide();
    state.status = "answer hidden: presenting";
    refresh();
    return false;
  }
  const d = displays.find((x) => x.id === p.displayId)!;
  const [w, h] = overlay.getSize();
  const b = overlay.getBounds();
  const onDisplay = b.x >= d.workArea.x && b.x < d.workArea.x + d.workArea.width && b.y >= d.workArea.y && b.y < d.workArea.y + d.workArea.height;
  if (!onDisplay || !overlay.isVisible()) overlay.setPosition(d.workArea.x + d.workArea.width - w - 24, d.workArea.y + 48); // top-right, near the camera
  overlay.webContents.send("overlay", { kind: "placement", protection: p.captureExclusion, reason: p.reason });
  void h;
  return true;
}

function showOverlay() {
  overlay?.showInactive(); // never steals focus from the meeting
}

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  if (state.pinned) return;
  hideTimer = setTimeout(() => overlay?.hide(), settings.autoHideSeconds * 1000);
}

// ---------- windows ----------
function createCapture() {
  capture = new BrowserWindow({
    show: false, width: 200, height: 100,
    webPreferences: { preload: path.join(__dirname, "preload-capture.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  lockDown(capture);
  void capture.loadFile(path.join(STATIC, "capture.html"));
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.show();
  settingsWin = new BrowserWindow({
    width: 760, height: 820, title: "ContextHarbor settings", show: true,
    webPreferences: { preload: path.join(__dirname, "preload-settings.js"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.setContentProtection(true); // history and transcripts are private too
  lockDown(settingsWin);
  void settingsWin.loadFile(path.join(STATIC, "settings.html"));
}

function lockDown(w: BrowserWindow) {
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

// ---------- tray, hotkeys ----------
function trayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const on = state.listening && !state.paused;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 < 36;
    buf.set(inside ? (on ? [0x40, 0xc0, 0x40, 0xff] : [0x90, 0x90, 0x90, 0xff]) : [0, 0, 0, 0], (y * size + x) * 4);
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function refresh() {
  if (!tray || tray.isDestroyed()) return;
  const m = state.meeting;
  const label = state.paused ? "Paused" : state.listening ? `Listening${state.captureMode === "simulated" ? " (simulated audio)" : ""}` : m ? "Meeting detected" : "Idle";
  tray.setImage(trayIcon());
  tray.setToolTip(`ContextHarbor — ${label}${ctx ? ` — ${ctx.userId}` : ""}`);
  const policy = currentPolicy();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${label}${ctx ? ` · ${ctx.userId}` : ""}`, enabled: false },
    ...(m ? [
      { label: `Meeting: ${m.live.meta.title.slice(0, 40)}`, enabled: false },
      { label: policy?.persist ? "Recording: saving to your notes" : `Recording: not saved (${(policy?.reason ?? "").slice(0, 50)})`, enabled: false },
      { label: "All participants consented to recording", type: "checkbox" as const, checked: m.consented, click: (i: Electron.MenuItem) => { m.consented = i.checked; refresh(); } },
    ] : []),
    { type: "separator" },
    { label: state.paused ? "Resume listening" : "Pause listening", accelerator: settings.hotkeys.pause, click: togglePause },
    { label: "Answer now", accelerator: settings.hotkeys.ask, click: manualAsk },
    { label: "Show/hide answer panel", accelerator: settings.hotkeys.toggle, click: toggleOverlay },
    { label: "Settings, history and data…", click: openSettings },
    { type: "separator" },
    { label: "Quit ContextHarbor", click: () => app.quit() },
  ]));
  overlay?.webContents.send("overlay", { kind: "state", paused: state.paused, listening: state.listening, user: ctx?.userId ?? "", status: state.status, simulated: state.captureMode === "simulated", pinned: state.pinned });
}

function togglePause() {
  state.paused = !state.paused;
  if (state.paused) stopListening();
  else if (state.meeting) startListening();
  log({ ev: state.paused ? "paused" : "resumed" });
  refresh();
}

function toggleOverlay() {
  if (!overlay) return;
  if (overlay.isVisible()) overlay.hide();
  else if (placeOverlay()) showOverlay();
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const map: [keyof Settings["hotkeys"], () => void][] = [
    ["pause", togglePause], ["ask", manualAsk], ["toggle", toggleOverlay],
    ["pin", () => { state.pinned = !state.pinned; if (!state.pinned) scheduleHide(); else if (hideTimer) clearTimeout(hideTimer); refresh(); }],
    ["dismiss", () => overlay?.hide()],
  ];
  for (const [k, fn] of map) if (!globalShortcut.register(settings.hotkeys[k], fn)) log({ ev: "hotkey_unavailable", k });
}

// ---------- settings IPC (renderer input is untrusted) ----------
function fromSettings(e: Electron.IpcMainInvokeEvent) {
  if (!settingsWin || e.sender !== settingsWin.webContents) throw new Error("forbidden");
}
ipcMain.handle("settings:get", (e) => {
  fromSettings(e);
  return { settings, displays: screen.getAllDisplays().map((d) => ({ id: d.id, label: `${d.label || "Display"} ${d.bounds.width}×${d.bounds.height}` })), embedder: ctx?.embedderId, kbChunks: ctx ? ctx.kb.count(ctx.userId) : 0, platform: process.platform, week: weekOf(new Date()).folder };
});
ipcMain.handle("settings:patch", async (e, patch: unknown) => {
  fromSettings(e);
  const kbChanged = (patch as { knowledgeBaseDir?: string })?.knowledgeBaseDir;
  settings = applyPatch(settings, patch);
  settingsFile.save(settings);
  registerHotkeys();
  if (stt) stt.vocabulary = vocabulary();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.startAtLogin });
  if (kbChanged && ctx) await switchUser(ctx.userId);
  refresh();
  return settings;
});
ipcMain.handle("settings:switchUser", async (e, id: unknown) => {
  fromSettings(e);
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(id)) throw new Error("invalid user id");
  settings.knowledgeBaseDir = path.join(app.getPath("documents"), "ContextHarbor", id, "knowledge-base");
  await switchUser(id);
  return settings;
});
ipcMain.handle("settings:meetings", (e) => {
  fromSettings(e);
  return ctx?.vault.meetings().map((m) => ({ id: m.id, title: m.title, startedAt: m.startedAt, endedAt: m.endedAt, chars: m.transcript.length })) ?? [];
});
ipcMain.handle("settings:meeting", (e, id: unknown) => {
  fromSettings(e);
  return typeof id === "string" ? ctx?.vault.meeting(id)?.transcript ?? "" : "";
});
ipcMain.handle("settings:exportMeeting", async (e, id: unknown) => {
  fromSettings(e);
  const text = typeof id === "string" ? ctx?.vault.exportMeeting(id) : undefined;
  if (!text || !settingsWin) return false;
  const r = await dialog.showSaveDialog(settingsWin, { defaultPath: `meeting-${id}.md` });
  if (r.canceled || !r.filePath) return false;
  writeFileSync(r.filePath, text, { mode: 0o600 });
  return true;
});
ipcMain.handle("settings:deleteMeeting", (e, id: unknown) => {
  fromSettings(e);
  if (typeof id !== "string" || !ctx) return false;
  const m = ctx.vault.meeting(id);
  if (m) {
    ctx.kb.removeDocument(ctx.userId, `${m.folder}/transcript.md`);
    ctx.kb.removeDocument(ctx.userId, `${m.folder}/summary.md`);
  }
  ctx.vault.deleteMeeting(id);
  return true;
});
ipcMain.handle("settings:history", (e) => {
  fromSettings(e);
  return ctx?.vault.history().slice(-200).reverse() ?? [];
});
ipcMain.handle("settings:setApiKey", (e, ref: unknown, key: unknown) => {
  fromSettings(e);
  if (typeof ref !== "string" || !/^[a-z0-9-]{1,40}$/.test(ref) || typeof key !== "string" || key.length > 400) throw new Error("bad key");
  const dir = path.join(app.getPath("userData"), "keys");
  require("node:fs").mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, `${ref}.bin`), safeStorage.encryptString(key), { mode: 0o600 });
  return true;
});
ipcMain.handle("settings:openKb", (e) => {
  fromSettings(e);
  void shell.openPath(settings.knowledgeBaseDir);
});
ipcMain.handle("settings:wipe", async (e) => {
  fromSettings(e);
  if (!ctx || !settingsWin) return false;
  const r = await dialog.showMessageBox(settingsWin, {
    type: "warning", buttons: ["Cancel", "Wipe my data"], defaultId: 0, cancelId: 0,
    message: `Delete all ContextHarbor data for ${ctx.userId}?`,
    detail: "Removes the index, recordings, transcripts, summaries, answer history, caches and logs. Your own knowledge-base files are not touched.",
  });
  if (r.response !== 1) return false;
  const id = ctx.userId;
  await endMeeting("wipe", true);
  logs.length = 0;
  ctx.wipe();
  ctx = null;
  await switchUser(id);
  return true;
});

/** GUI apps start with a minimal PATH; also look in the usual package-manager locations. */
function resolveBin(name: string) {
  if (path.isAbsolute(name)) return name;
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const d of dirs) for (const e of exts) if (d && require("node:fs").existsSync(path.join(d, name + e))) return path.join(d, name + e);
  return name;
}

// ---------- startup ----------
app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.hide();
  settingsFile = new SettingsFile(path.join(app.getPath("userData"), "settings.json"));
  const osUser = os.userInfo().username.replace(/[^A-Za-z0-9._-]/g, "") || "user";
  settings = settingsFile.load(() => defaults(osUser, app.getPath("home"), APP_DIR));
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.startAtLogin });

  // Loopback system audio for the hidden capture window; video track is dropped immediately in the renderer.
  // Always answer the request: an unanswered one (e.g. no Screen Recording permission) blocks shutdown.
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    if (req.frame?.top?.processId !== capture?.webContents.getProcessId()) return cb({});
    desktopCapturer.getSources({ types: ["screen"] }).then(
      (s) => (s[0] ? cb({ video: s[0], audio: "loopback" }) : cb({})),
      (e) => { log({ ev: "loopback_denied", err: String(e).slice(0, 60) }); cb({}); },
    );
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(wc === capture?.webContents && (perm === "media" || perm === "display-capture")));

  // External processes cannot read inside app.asar; packaged builds unpack models/ next to it.
  const sttModel = (path.isAbsolute(settings.stt.modelPath) ? settings.stt.modelPath : path.join(APP_DIR, settings.stt.modelPath)).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  try {
    await WhisperCli.verify(sttModel, settings.stt.modelSha256);
    stt = new WhisperCli(resolveBin(settings.stt.binary), sttModel, "");
  } catch (e) {
    log({ ev: "stt_unavailable", err: String(e).slice(0, 80) });
    state.status = "transcription unavailable";
  }
  ocr = new Ocr(path.join(app.getPath("userData"), "ocr"));

  tray = new Tray(trayIcon());
  createOverlay();
  createCapture();
  await switchUser(settings.userId);
  registerHotkeys();
  log({ ev: "started", platform: process.platform, mic: process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("microphone") : "n/a" });
  setInterval(() => void pollMeeting().catch((e) => log({ ev: "poll_error", err: String(e).slice(0, 60) })), DEMO_MEETING ? 1000 : 5000);
  setInterval(() => {
    if (state.meeting && ctx) void ctx.memory.updateRunning(state.meeting.live).catch(() => {});
    flushLogs();
  }, 60_000);
  if (process.env.CH_OPEN_SETTINGS === "1") openSettings();
  if (process.env.CH_E2E_SETTINGS_OUT) {
    openSettings();
    settingsWin!.webContents.once("did-finish-load", () => setTimeout(async () => {
      writeFileSync(process.env.CH_E2E_SETTINGS_OUT!, (await settingsWin!.webContents.capturePage()).toPNG());
      app.quit();
    }, 1500));
  }
  void pollMeeting();
});

app.on("window-all-closed", () => {}); // background app: closing windows never quits
if (process.env.CH_EXIT_AFTER_MS) setTimeout(() => { if (process.env.CH_SHOW_OVERLAY) showOverlay(); setTimeout(() => app.quit(), 1000); }, Number(process.env.CH_EXIT_AFTER_MS));
for (const ev of ["before-quit", "will-quit", "quit"] as const) app.on(ev as "quit", () => process.env.CH_E2E && console.error(`[lifecycle] ${ev}`));
let quitting = false;
app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  void endMeeting("quit");
  flushLogs();
  globalShortcut.unregisterAll();
  stt?.dispose();
  ctx?.dispose();
  // Late IPC (e.g. the capture window's "stopped") must not touch a destroyed tray: that deadlocks shutdown.
  const t = tray;
  tray = null;
  t?.destroy();
});

// Test hooks for the end-to-end demo script (no effect unless the env flag is set).
if (process.env.CH_E2E === "1") {
  ipcMain.handle("e2e:state", () => ({ meeting: state.meeting?.live.meta.title ?? null, items: state.meeting?.live.items.length ?? 0, status: state.status, overlayVisible: overlay?.isVisible() ?? false }));
  (globalThis as Record<string, unknown>).__ch = { state, answer, manualAsk, overlay: () => overlay, ctx: () => ctx };
}
