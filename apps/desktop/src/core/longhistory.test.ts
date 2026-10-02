// Brief <context_management> test 6: 52 weekly occurrences plus one 3-hour meeting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeBase } from "./kb";
import { HashEmbedder } from "./embed";
import { LiveContextBuffer } from "./live";
import { MeetingMemory, MemoryStore, ExtractiveSummarizer, CAPS } from "./memory";
import { AnswerPipeline } from "./pipeline";
import { type LLM, type GenerateRequest } from "./llm";
import { DEFAULT_BUDGET, inputBudget, estimateTokens } from "./budget";

class Recorder implements LLM {
  readonly id = "recorder";
  last: GenerateRequest | null = null;
  async generate(req: GenerateRequest) {
    this.last = req;
    return { text: "- ok\n— sources: x.md (2026-01-01)", totalMs: 1 };
  }
}

const WEEK = 7 * 86_400_000;
const START = Date.parse("2025-10-06T16:00:00Z"); // Monday

test("52 weekly syncs + a 3-hour meeting: every request under budget, early facts still retrievable", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "long-"));
  const kb = new KnowledgeBase(path.join(dir, "kb.sqlite"), new HashEmbedder());
  const store = new MemoryStore();
  const mem = new MeetingMemory("u", kb, store, new ExtractiveSummarizer());

  for (let w = 0; w < 52; w++) {
    const t0 = START + w * WEEK;
    const live = new LiveContextBuffer({ id: `wk${w}`, title: "Weekly sync", app: "Teams", startedAt: t0, participants: ["Priya", "Sam"], seriesId: "weekly-sync" }, 5 * 60_000);
    for (let i = 0; i < 120; i++) {
      live.add({ t: t0 + i * 20_000, kind: "speech", speaker: i % 2 ? "Priya" : "Sam", text: `General discussion item ${i} about roadmap, hiring and infra for week ${w}.` });
    }
    live.add({ t: t0 + 41 * 60_000, kind: "speech", speaker: "Priya", text: `We decided the vendor code for week ${w} is VND${1000 + w}, owner Sam.` });
    await mem.finalize(live);
  }
  assert.ok(estimateTokens(mem.seriesSummary("weekly-sync")) <= CAPS.series);
  for (const k of store.keys("monthly:")) assert.ok(estimateTokens(store.get(k)!) <= CAPS.monthly);
  for (const k of store.keys("quarterly:")) assert.ok(estimateTokens(store.get(k)!) <= CAPS.quarterly);

  // A 3-hour meeting happening now (one line every 5 s = 2,160 lines).
  const now = START + 52 * WEEK + 3 * 3_600_000;
  const live = new LiveContextBuffer({ id: "long", title: "Weekly sync", app: "Teams", startedAt: now - 3 * 3_600_000, participants: ["Priya"], seriesId: "weekly-sync" });
  for (let i = 0; i < 2160; i++) live.add({ t: now - 3 * 3_600_000 + i * 5_000, kind: "speech", speaker: "Priya", text: `Long meeting line ${i} covering budget ${i * 7} and timelines.` });
  await mem.updateRunning(live, now);
  assert.ok(estimateTokens(live.summary) <= CAPS.running);

  const llm = new Recorder();
  const pipe = new AnswerPipeline("u", kb, [llm]);
  const budget = inputBudget(DEFAULT_BUDGET);
  const latencies: number[] = [];
  for (const w of [0, 1, 2, 10, 25, 51]) {
    const a = await pipe.answer(`Varish, what was the vendor code decided in week ${w}?`, "Priya", live,
      { seriesSummary: mem.seriesSummary("weekly-sync"), rollupSummary: mem.rollupFor(new Date(now).toISOString().slice(0, 10)) }, { now });
    latencies.push(a.timings.retrievalMs);
    assert.ok(a.requestTokens <= budget, `request ${a.requestTokens} over budget ${budget}`);
    const prompt = llm.last!.messages[0].content;
    assert.ok(prompt.includes(`VND${1000 + w}`), `week ${w} fact must be retrieved`);
    assert.ok(estimateTokens(llm.last!.system + prompt) <= budget);
  }
  const p95 = latencies.sort((a, b) => a - b)[Math.ceil(latencies.length * 0.95) - 1];
  assert.ok(p95 < 1500, `retrieval p95 ${p95} ms should leave room in the 2-3 s target`);
  console.log(`retrieval latencies ms: ${latencies.join(", ")}; chunks indexed: ${kb.count("u")}`);
  kb.close();
  rmSync(dir, { recursive: true });
});
