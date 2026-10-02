// Encrypted local storage (AES-256-GCM), recording policy, retention, export, and one-click wipe.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { SummaryStore } from "./memory";

export class EncryptedFiles {
  constructor(readonly dir: string, private key: Buffer) {
    if (key.length !== 32) throw new Error("key must be 32 bytes");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  write(name: string, data: string) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(data, "utf8"), c.final()]);
    const file = this.file(name);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, Buffer.concat([iv, c.getAuthTag(), ct]), { mode: 0o600 });
    renameSync(`${file}.tmp`, file); // atomic replace
  }

  read(name: string): string | undefined {
    const file = this.file(name);
    if (!existsSync(file)) return undefined;
    const b = readFileSync(file);
    const d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  }

  list(prefix = "") {
    const root = path.join(this.dir, prefix);
    if (!existsSync(root)) return [];
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".enc"))
      .map((e) => path.relative(this.dir, path.join(e.parentPath, e.name)).replace(/\.enc$/, "").replace(/\\/g, "/"));
  }

  remove(name: string) {
    rmSync(this.file(name), { force: true });
  }

  private file(name: string) {
    if (name.includes("..")) throw new Error("bad name");
    return path.join(this.dir, `${name}.enc`);
  }
}

/** SummaryStore persisted as one encrypted JSON document. */
export class EncryptedSummaryStore implements SummaryStore {
  private m: Record<string, string>;
  constructor(private files: EncryptedFiles, private name = "summaries") {
    this.m = JSON.parse(files.read(name) ?? "{}");
  }
  get(k: string) {
    return this.m[k];
  }
  set(k: string, v: string) {
    this.m[k] = v;
    this.files.write(this.name, JSON.stringify(this.m));
  }
  keys(prefix: string) {
    return Object.keys(this.m).filter((k) => k.startsWith(prefix));
  }
  deleteWhere(pred: (k: string) => boolean) {
    for (const k of Object.keys(this.m)) if (pred(k)) delete this.m[k];
    this.files.write(this.name, JSON.stringify(this.m));
  }
}

// ---- Recording policy (Part 2, Sections 2a and 9) ----

export interface RecordingPolicy {
  /** Owner/organization decision. "not_set" behaves like "not_allowed". */
  organization: "not_set" | "allowed" | "not_allowed";
  /** The user confirms local law and meeting consent/notification requirements are met for meetings they record. */
  consentConfirmed: boolean;
  /** Jurisdiction requires every participant's consent. */
  allPartyConsent: boolean;
  /** Never record meetings whose title matches (exams, interviews, assessments...). */
  blockedTitlePattern: string;
}

export const DEFAULT_POLICY: RecordingPolicy = {
  organization: "not_set",
  consentConfirmed: false,
  allPartyConsent: true,
  blockedTitlePattern: "exam|assessment|interview|test|quiz|certification",
};

export interface PolicyDecision {
  persist: boolean; // save transcript/chat/screen text and index it
  assist: boolean; // allowed to run at all (rolling in-memory window)
  reason: string;
}

export function decidePolicy(p: RecordingPolicy, meeting: { title: string; participantsConsented?: boolean }): PolicyDecision {
  let blocked = false;
  try {
    blocked = !!p.blockedTitlePattern && new RegExp(`\\b(${p.blockedTitlePattern})\\b`, "i").test(meeting.title);
  } catch {
    blocked = false;
  }
  if (blocked) return { persist: false, assist: false, reason: "meeting looks like an exam/assessment/interview; assistant stays off" };
  if (p.organization !== "allowed") return { persist: false, assist: true, reason: "recording not permitted by policy; rolling in-memory context only" };
  if (!p.consentConfirmed) return { persist: false, assist: true, reason: "consent not confirmed; rolling in-memory context only" };
  if (p.allPartyConsent && !meeting.participantsConsented) {
    return { persist: false, assist: true, reason: "all-party consent required and not confirmed for this meeting; nothing saved" };
  }
  return { persist: true, assist: true, reason: "recording permitted" };
}

// ---- Retention, export, wipe (Part 2, Section 8) ----

export interface Retention {
  transcriptDays: number; // transcripts, chat, shared-content text
  answerHistoryDays: number;
}
export const DEFAULT_RETENTION: Retention = { transcriptDays: 30, answerHistoryDays: 30 };

export interface MeetingRecord {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number;
  folder: string; // KB path prefix
  transcript: string;
}

export interface HistoryEntry {
  t: number;
  meetingId: string | null;
  question: string;
  answer: string;
  status: string;
}

export class UserVault {
  constructor(readonly files: EncryptedFiles) {}

  saveMeeting(m: MeetingRecord) {
    this.files.write(`meetings/${m.id}`, JSON.stringify(m));
  }
  meetings(): MeetingRecord[] {
    return this.files.list("meetings").map((n) => JSON.parse(this.files.read(n)!) as MeetingRecord).sort((a, b) => b.startedAt - a.startedAt);
  }
  meeting(id: string) {
    const s = this.files.read(`meetings/${id}`);
    return s ? (JSON.parse(s) as MeetingRecord) : undefined;
  }
  deleteMeeting(id: string) {
    this.files.remove(`meetings/${id}`);
  }
  exportMeeting(id: string) {
    const m = this.meeting(id);
    return m ? `${m.transcript}\n` : undefined;
  }

  addHistory(e: HistoryEntry) {
    const h = this.history();
    h.push(e);
    this.files.write("history", JSON.stringify(h));
  }
  history(): HistoryEntry[] {
    return JSON.parse(this.files.read("history") ?? "[]");
  }

  /** Applies retention. Returns removed meeting records so callers can drop their index entries. */
  purge(r: Retention, now = Date.now()) {
    const removed = this.meetings().filter((m) => m.endedAt < now - r.transcriptDays * 86_400_000);
    for (const m of removed) this.deleteMeeting(m.id);
    const keep = this.history().filter((e) => e.t >= now - r.answerHistoryDays * 86_400_000);
    this.files.write("history", JSON.stringify(keep));
    return removed;
  }
}

/** One-click wipe: removes the user's whole data directory (vault, index, caches, logs). */
export function wipeUserDir(userDir: string) {
  rmSync(userDir, { recursive: true, force: true });
}
