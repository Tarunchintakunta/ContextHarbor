import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { EncryptedFiles, UserVault, decidePolicy, DEFAULT_POLICY, wipeUserDir, EncryptedSummaryStore } from "./store";

test("files are encrypted at rest and tamper-evident", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "enc-"));
  const f = new EncryptedFiles(dir, randomBytes(32));
  f.write("meetings/m1", "SECRET-TRANSCRIPT-LINE");
  const raw = readFileSync(path.join(dir, "meetings/m1.enc"));
  assert.ok(!raw.toString("latin1").includes("SECRET-TRANSCRIPT-LINE"));
  assert.equal(f.read("meetings/m1"), "SECRET-TRANSCRIPT-LINE");
  assert.throws(() => new EncryptedFiles(dir, randomBytes(32)).read("meetings/m1")); // wrong key
  assert.throws(() => f.read("../escape"));
  const s = new EncryptedSummaryStore(f);
  s.set("series:x", "summary");
  assert.equal(new EncryptedSummaryStore(f).get("series:x"), "summary");
  wipeUserDir(dir);
  assert.equal(existsSync(dir), false);
});

test("retention purges old meetings and history; review/export/delete per meeting", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ret-"));
  const v = new UserVault(new EncryptedFiles(dir, randomBytes(32)));
  const now = Date.parse("2026-10-02T00:00:00Z");
  const day = 86_400_000;
  v.saveMeeting({ id: "old", title: "Old", startedAt: now - 40 * day, endedAt: now - 40 * day, folder: "f", transcript: "old" });
  v.saveMeeting({ id: "new", title: "New", startedAt: now - day, endedAt: now - day, folder: "f", transcript: "new transcript" });
  v.addHistory({ t: now - 40 * day, meetingId: "old", question: "q", answer: "a", status: "answered" });
  v.addHistory({ t: now - day, meetingId: "new", question: "q", answer: "a", status: "answered" });
  const removed = v.purge({ transcriptDays: 30, answerHistoryDays: 30 }, now);
  assert.deepEqual(removed.map((m) => m.id), ["old"]);
  assert.deepEqual(v.meetings().map((m) => m.id), ["new"]);
  assert.equal(v.history().length, 1);
  assert.equal(v.exportMeeting("new"), "new transcript\n");
  v.deleteMeeting("new");
  assert.equal(v.meetings().length, 0);
  assert.deepEqual(readdirSync(path.join(dir, "meetings")), []);
});

test("recording policy: off by default, consent rules, exam blocking", () => {
  const m = { title: "Sprint sync" };
  assert.deepEqual(decidePolicy(DEFAULT_POLICY, m).persist, false);
  assert.equal(decidePolicy(DEFAULT_POLICY, m).assist, true);
  const allowed = { ...DEFAULT_POLICY, organization: "allowed" as const, consentConfirmed: true };
  assert.equal(decidePolicy(allowed, m).persist, false); // all-party consent default
  assert.equal(decidePolicy(allowed, { ...m, participantsConsented: true }).persist, true);
  assert.equal(decidePolicy({ ...allowed, allPartyConsent: false }, m).persist, true);
  assert.equal(decidePolicy(allowed, { title: "Final exam review session" }).assist, false);
  assert.equal(decidePolicy({ ...allowed, organization: "not_allowed" }, { ...m, participantsConsented: true }).persist, false);
});
