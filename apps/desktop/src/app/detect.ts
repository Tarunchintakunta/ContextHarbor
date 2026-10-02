// Meeting detection from process names, window titles and audio activity (Part 2, Section 2).
import { execFile } from "node:child_process";

export interface WindowInfo {
  id: string;
  title: string;
}

export interface Detection {
  active: boolean;
  app: string | null;
  title: string | null;
  windowId: string | null;
  sharing: boolean; // the user appears to be presenting
  signals: string[];
}

// Processes that exist only while a call is live (CptHost = Zoom in-meeting host on macOS).
const IN_CALL_PROCS: [RegExp, string][] = [
  [/^CptHost$|zoom\.us.*meeting|^Zoom Meeting$/i, "Zoom"],
];
const MEETING_APPS: [RegExp, string][] = [
  [/^zoom\.us$|^Zoom\.exe$|^zoom$/i, "Zoom"],
  [/^MSTeams$|^ms-teams(\.exe)?$|^Microsoft Teams/i, "Microsoft Teams"],
  [/webex|CiscoCollabHost|atmgr/i, "Webex"],
  [/^Slack(\.exe)?$|^slack$/i, "Slack"],
];
const TITLES: [RegExp, string][] = [
  [/\bMeet\s*[-–]\s*[a-z]{3}-[a-z]{4}-[a-z]{3}\b|^Meet\s*[-–]|Google Meet/i, "Google Meet"],
  [/Zoom Meeting|Zoom Webinar|^Meeting$/i, "Zoom"],
  [/\b(Meeting|Call)\b.*\|\s*Microsoft Teams|Microsoft Teams.*\b(Meeting|Call)\b/i, "Microsoft Teams"],
  [/Webex|Meeting Center/i, "Webex"],
  [/\bHuddle\b/i, "Slack"],
  [/whereby|jitsi|gotomeeting|bluejeans|chime/i, "Other"],
];
const SHARING = /is presenting|you are presenting|you'?re presenting|sharing control bar|zoom share toolbar|share toolbar|stop share|stop presenting|\bpresenting\b/i;

export function processList(): Promise<string[]> {
  const [cmd, args] =
    process.platform === "win32" ? ["tasklist", ["/fo", "csv", "/nh"]] : process.platform === "darwin" ? ["ps", ["-axco", "comm"]] : ["ps", ["-eo", "comm"]];
  return new Promise((res) =>
    execFile(cmd, args as string[], { timeout: 4000, maxBuffer: 4_000_000 }, (e, out) =>
      res(e ? [] : out.split("\n").map((l) => (process.platform === "win32" ? l.split(",")[0]?.replace(/"/g, "") : l).trim()).filter(Boolean)),
    ),
  );
}

/** Pure decision from observed signals; unit-tested. */
export function classify(procs: string[], windows: WindowInfo[], audioActive: boolean): Detection {
  const signals: string[] = [];
  let app: string | null = null;
  for (const p of procs) {
    const hit = IN_CALL_PROCS.find(([re]) => re.test(p));
    if (hit) {
      app = hit[1];
      signals.push(`in-call process ${p}`);
    }
  }
  let win: WindowInfo | null = null;
  for (const w of windows) {
    const hit = TITLES.find(([re]) => re.test(w.title));
    if (hit) {
      win ??= w;
      app ??= hit[1];
      signals.push(`window "${w.title.slice(0, 60)}"`);
    }
  }
  const appRunning = procs.some((p) => MEETING_APPS.some(([re]) => re.test(p)));
  if (appRunning) signals.push("meeting app running");
  if (audioActive) signals.push("audio active");
  // A matching meeting window/in-call process is required; audio alone (music, videos) never starts capture.
  const active = !!app && (signals.some((s) => s.startsWith("in-call")) || !!win);
  const sharing = windows.some((w) => SHARING.test(w.title));
  return { active, app: active ? app : null, title: win?.title ?? null, windowId: win?.id ?? null, sharing, signals };
}
