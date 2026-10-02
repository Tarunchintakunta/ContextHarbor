// User settings (non-secret). API keys live in the OS keychain via Electron safeStorage, never here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_POLICY, DEFAULT_RETENTION, type RecordingPolicy, type Retention } from "../core/store";
import type { ModelConfig } from "../core/llm";
import type { Profile } from "../core/question";

export interface Hotkeys {
  pause: string;
  ask: string; // manual "answer now"
  toggle: string; // show/hide overlay
  pin: string;
  dismiss: string;
}

export interface Settings {
  userId: string; // active local user; switching clears everything
  users: string[];
  profile: Profile;
  knowledgeBaseDir: string;
  policy: RecordingPolicy;
  retention: Retention;
  hotkeys: Hotkeys;
  display: { mode: "auto" | "primary" | "secondary" | "id"; displayId?: number; trustCaptureExclusion: boolean };
  autoHideSeconds: number;
  startAtLogin: boolean;
  models: ModelConfig[]; // pinned chain: cheapest passing model first
  embedding: { provider: "ollama" | "hash"; model: string; digest: string };
  stt: { engine: "whisper-cli"; binary: string; modelPath: string; modelSha256: string };
}

export function defaults(userId: string, home: string, appDir: string): Settings {
  return {
    userId,
    users: [userId],
    profile: { names: [userId], roles: [], ownedTopics: [] },
    knowledgeBaseDir: path.join(home, "Documents", "ContextHarbor", userId, "knowledge-base"),
    policy: DEFAULT_POLICY,
    retention: DEFAULT_RETENTION,
    hotkeys: { pause: "CommandOrControl+Alt+P", ask: "CommandOrControl+Alt+A", toggle: "CommandOrControl+Alt+H", pin: "CommandOrControl+Alt+K", dismiss: "CommandOrControl+Alt+D" },
    display: { mode: "auto", trustCaptureExclusion: false },
    autoHideSeconds: 25,
    startAtLogin: true,
    models: JSON.parse(readFileSync(path.join(appDir, "config", "models.json"), "utf8")).chain,
    embedding: JSON.parse(readFileSync(path.join(appDir, "config", "models.json"), "utf8")).embedding,
    stt: JSON.parse(readFileSync(path.join(appDir, "config", "models.json"), "utf8")).stt,
  };
}

export class SettingsFile {
  constructor(private file: string) {}
  load(fallback: () => Settings): Settings {
    if (!existsSync(this.file)) return fallback();
    const base = fallback();
    const saved = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Settings>;
    return { ...base, ...saved, policy: { ...base.policy, ...saved.policy }, retention: { ...base.retention, ...saved.retention }, hotkeys: { ...base.hotkeys, ...saved.hotkeys }, display: { ...base.display, ...saved.display } };
  }
  save(s: Settings) {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(this.file, JSON.stringify(s, null, 2), { mode: 0o600 });
  }
}

/** Validates a settings patch coming from the settings renderer (untrusted input). */
export function applyPatch(s: Settings, patch: unknown): Settings {
  if (!patch || typeof patch !== "object") throw new Error("bad patch");
  const p = patch as Record<string, unknown>;
  const out = structuredClone(s);
  const str = (v: unknown, max = 500) => (typeof v === "string" && v.length <= max ? v : undefined);
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 100)).filter((x): x is string => !!x).slice(0, 30) : undefined);
  if (p.profile && typeof p.profile === "object") {
    const pr = p.profile as Record<string, unknown>;
    out.profile = { names: list(pr.names) ?? s.profile.names, roles: list(pr.roles) ?? s.profile.roles, ownedTopics: list(pr.ownedTopics) ?? s.profile.ownedTopics };
  }
  if (str(p.knowledgeBaseDir)) out.knowledgeBaseDir = str(p.knowledgeBaseDir)!;
  if (p.policy && typeof p.policy === "object") {
    const po = p.policy as Record<string, unknown>;
    if (["not_set", "allowed", "not_allowed"].includes(po.organization as string)) out.policy.organization = po.organization as RecordingPolicy["organization"];
    if (typeof po.consentConfirmed === "boolean") out.policy.consentConfirmed = po.consentConfirmed;
    if (typeof po.allPartyConsent === "boolean") out.policy.allPartyConsent = po.allPartyConsent;
    if (str(po.blockedTitlePattern, 300) !== undefined) out.policy.blockedTitlePattern = str(po.blockedTitlePattern, 300)!;
  }
  if (p.retention && typeof p.retention === "object") {
    const r = p.retention as Record<string, unknown>;
    const days = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3650 ? (v as number) : undefined);
    out.retention.transcriptDays = days(r.transcriptDays) ?? s.retention.transcriptDays;
    out.retention.answerHistoryDays = days(r.answerHistoryDays) ?? s.retention.answerHistoryDays;
  }
  if (p.hotkeys && typeof p.hotkeys === "object") {
    for (const k of Object.keys(s.hotkeys) as (keyof Hotkeys)[]) {
      const v = str((p.hotkeys as Record<string, unknown>)[k], 60);
      if (v && /^[A-Za-z0-9+]+$/.test(v)) out.hotkeys[k] = v;
    }
  }
  if (p.display && typeof p.display === "object") {
    const d = p.display as Record<string, unknown>;
    if (["auto", "primary", "secondary", "id"].includes(d.mode as string)) out.display.mode = d.mode as Settings["display"]["mode"];
    if (Number.isInteger(d.displayId)) out.display.displayId = d.displayId as number;
    if (typeof d.trustCaptureExclusion === "boolean") out.display.trustCaptureExclusion = d.trustCaptureExclusion;
  }
  if (Number.isInteger(p.autoHideSeconds) && (p.autoHideSeconds as number) >= 5 && (p.autoHideSeconds as number) <= 600) out.autoHideSeconds = p.autoHideSeconds as number;
  if (typeof p.startAtLogin === "boolean") out.startAtLogin = p.startAtLogin;
  return out;
}
