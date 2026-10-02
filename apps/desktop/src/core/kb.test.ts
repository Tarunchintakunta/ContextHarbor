import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeBase, IsolationError, assertOwned, chunk } from "./kb";
import { HashEmbedder } from "./embed";

const now = new Date("2026-10-02T12:00:00Z");

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "kb-"));
  const kb = new KnowledgeBase(path.join(dir, "kb.sqlite"), new HashEmbedder());
  return { dir, kb };
}

test("retrieval is filtered by user: similar titles, contradictory facts never cross", async () => {
  const { dir, kb } = fixture();
  await kb.upsertDocument("alice", "2026/W40_2026-09-28_to_2026-10-04/payments-status-2026-09-30.md",
    "# Payments migration status\n\nThe payments migration launch date is October 14. Owner: Alice.");
  await kb.upsertDocument("bob", "2026/W40_2026-09-28_to_2026-10-04/payments-status-2026-09-30.md",
    "# Payments migration status\n\nThe payments migration launch date is November 30. Owner: Bob.");
  const a = await kb.search("alice", "when is the payments migration launch date?", { now });
  const b = await kb.search("bob", "when is the payments migration launch date?", { now });
  assert.ok(a.length && b.length);
  assert.ok(a.every((p) => p.userId === "alice" && !p.text.includes("November")));
  assert.ok(b.every((p) => p.userId === "bob" && !p.text.includes("October 14")));
  await assert.rejects(kb.search("", "payments", { now }), IsolationError);
  assert.throws(() => assertOwned("alice", [...a, ...b]), IsolationError);
  kb.close();
  rmSync(dir, { recursive: true });
});

test("time hints boost the matching week; irrelevant questions return nothing", async () => {
  const { dir, kb } = fixture();
  await kb.upsertDocument("u1", "2026/W39_2026-09-21_to_2026-09-27/standup-2026-09-22.md", "Standup: API latency p95 was 420 ms.");
  await kb.upsertDocument("u1", "2026/W40_2026-09-28_to_2026-10-04/standup-2026-09-29.md", "Standup: API latency p95 was 180 ms.");
  const lastWeek = await kb.search("u1", "what was API latency last week", { weeks: ["2026-W39"], now });
  assert.match(lastWeek[0].text, /420/);
  const thisWeek = await kb.search("u1", "what was API latency this week", { weeks: ["2026-W40"], now });
  assert.match(thisWeek[0].text, /180/);
  assert.deepEqual(await kb.search("u1", "who won the football final?", { now }), []);
  kb.close();
  rmSync(dir, { recursive: true });
});

test("folder sync is incremental and removes deleted files; metadata comes from week folders", async () => {
  const { dir, kb } = fixture();
  const root = path.join(dir, "knowledge-base");
  const wk = path.join(root, "2026/W40_2026-09-28_to_2026-10-04");
  mkdirSync(wk, { recursive: true });
  mkdirSync(path.join(root, "_reference"), { recursive: true });
  writeFileSync(path.join(wk, "incident-report-2026-10-01.md"), "Incident INC-4821: checkout outage for 12 minutes.");
  writeFileSync(path.join(root, "_reference/project-overview.md"), "Project Atlas rebuilds checkout.");
  assert.equal(await kb.syncFolder("u1", root), 2);
  assert.equal(await kb.syncFolder("u1", root), 0);
  const [hit] = await kb.search("u1", "INC-4821 outage", { now });
  assert.equal(hit.week, "2026-W40");
  assert.equal(hit.date, "2026-10-01");
  assert.equal(hit.docType, "note");
  await kb.upsertDocument("u1", "2026/W40_2026-09-28_to_2026-10-04/meetings/2026-10-01_sync/transcript.md", "Recorded sync about INC-4821 follow-up.", { docType: "meeting", origin: "app" });
  rmSync(path.join(wk, "incident-report-2026-10-01.md"));
  assert.equal(await kb.syncFolder("u1", root), 1);
  const after = await kb.search("u1", "INC-4821 outage", { now });
  assert.ok(after.every((p) => p.docType === "meeting"), "app-recorded meeting survives folder sync; deleted file is gone");
  assert.equal(after.length, 1);
  kb.close();
  rmSync(dir, { recursive: true });
});

test("embedder is pinned: a different embedder refuses to open the index", () => {
  const { dir, kb } = fixture();
  kb.close();
  assert.throws(() => new KnowledgeBase(path.join(dir, "kb.sqlite"), { id: "other", embed: async () => [] }), /Re-index deliberately/);
  rmSync(dir, { recursive: true });
});

test("chunking keeps paragraphs and bounds size", () => {
  const parts = chunk(`# Title\n\n${"word ".repeat(400)}\n\nshort tail`);
  assert.ok(parts.every((p) => p.length <= 600));
  assert.ok(parts.length >= 3);
});
