import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeBase } from "./kb";
import { HashEmbedder } from "./embed";
import { LiveContextBuffer } from "./live";
import { AnswerPipeline, UNAVAILABLE } from "./pipeline";
import { type LLM, type GenerateRequest, LLMError, createLLM } from "./llm";
import { checkAnswer, NOTHING } from "./prompt";
import { assemble, DEFAULT_BUDGET, estimateTokens, inputBudget } from "./budget";

const NOW = Date.parse("2026-10-02T15:00:00Z");

class FakeLLM implements LLM {
  seen: GenerateRequest[] = [];
  constructor(readonly id: string, private reply: (req: GenerateRequest) => string | Error) {}
  async generate(req: GenerateRequest) {
    this.seen.push(req);
    const r = this.reply(req);
    if (r instanceof Error) throw r;
    return { text: r, totalMs: 1 };
  }
}

function meeting(id = "m1") {
  const live = new LiveContextBuffer({ id, title: "Sprint sync", app: "Google Meet", startedAt: NOW - 30 * 60_000, participants: ["Priya", "Varish"] });
  live.add({ t: NOW - 20 * 60_000, kind: "speech", speaker: "Priya", text: "Budget for the vendor is 42 thousand." });
  live.add({ t: NOW - 60_000, kind: "chat", speaker: "Priya", text: "Link to the payments board posted" });
  live.add({ t: NOW - 10_000, kind: "speech", speaker: "Priya", text: "Varish, when does the payments migration launch?" });
  return live;
}

test("INTEGRATION: another user's data never appears in a prompt", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iso-"));
  const kb = new KnowledgeBase(path.join(dir, "kb.sqlite"), new HashEmbedder());
  const ALICE = "CANARY-ALICE-7Q2";
  const BOB = "CANARY-BOB-9X4";
  for (const [u, canary, date] of [["alice", ALICE, "October 14"], ["bob", BOB, "November 30"]] as const) {
    await kb.upsertDocument(u, "2026/W40_2026-09-28_to_2026-10-04/payments-migration-2026-09-30.md",
      `# Payments migration\n\nThe payments migration launches ${date}. Tracking ${canary}.`);
    await kb.upsertDocument(u, `2026/W40_2026-09-28_to_2026-10-04/meetings/2026-09-29_sprint-sync/transcript.md`,
      `Payments migration launch discussed. ${canary} owner confirmed.`, { docType: "meeting" });
  }
  const llm = new FakeLLM("fake:1", () => "- Launch is October 14.\n— sources: payments-migration-2026-09-30.md (2026-09-30)");
  const pipe = new AnswerPipeline("alice", kb, [llm]);
  const questions = [
    "Varish, when does the payments migration launch?",
    `What is ${BOB}?`, // someone asks for another user's content directly
    "What did we decide about the payments migration last week?",
  ];
  for (const q of questions) await pipe.answer(q, "Priya", meeting(), {}, { now: NOW });
  const prompts = llm.seen.map((r) => r.system + JSON.stringify(r.messages));
  assert.ok(prompts.length === questions.length);
  assert.ok(prompts.some((p) => p.includes(ALICE)), "alice's own data is used");
  // Question 2 is speech in alice's meeting, so its words may appear in <question>/<meeting_context>.
  // Bob's stored data (his launch date, his canary inside documents) must never appear anywhere.
  const kbSections = (p: string) => (p.match(/<(retrieved_passages|past_meeting_segments|series_summary)>[\s\S]*?<\/\1>/g) ?? []).join("\n");
  for (const p of prompts) {
    assert.ok(!kbSections(p).includes(BOB), "bob's canary must never reach alice's retrieved context");
    assert.ok(!p.includes("November 30"), "bob's facts must never reach alice's prompt");
  }
  assert.ok(!prompts[0].includes(BOB) && !prompts[2].includes(BOB));
  assert.throws(() => new AnswerPipeline("", kb, [llm]));
  kb.close();
  rmSync(dir, { recursive: true });
});

test("request carries both live context and passages; empty retrieval still sends the section", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "req-"));
  const kb = new KnowledgeBase(path.join(dir, "kb.sqlite"), new HashEmbedder());
  await kb.upsertDocument("u", "_reference/project-overview.md", "Payments migration owner is Varish.");
  const llm = new FakeLLM("fake:1", () => NOTHING);
  const pipe = new AnswerPipeline("u", kb, [llm]);
  const live = meeting();
  const a = await pipe.answer("when does the payments migration launch?", "Priya", live, {}, { now: NOW });
  const msg = llm.seen[0].messages[0].content;
  assert.match(msg, /<meeting_context>[\s\S]*when does the payments migration launch/);
  assert.match(msg, /<retrieved_passages>[\s\S]*project-overview\.md/);
  assert.match(msg, /\(earlier\)[\s\S]*42 thousand|<question>/);
  assert.equal(a.status, "nothing");
  await pipe.answer("who won the football final?", "Priya", live, {}, { now: NOW });
  assert.match(llm.seen[1].messages[0].content, /<retrieved_passages>\n\n<\/retrieved_passages>/);
  kb.close();
  rmSync(dir, { recursive: true });
});

test("fallback chain: format failure and timeout move to the next model; all failing gives Unavailable", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fb-"));
  const kb = new KnowledgeBase(path.join(dir, "kb.sqlite"), new HashEmbedder());
  const bad = new FakeLLM("cheap", () => "Sure! Here is a long preamble without sources.");
  const slow = new FakeLLM("mid", () => new LLMError("timed out", "timeout"));
  const good = new FakeLLM("big", () => "Launch is October 14.\n— sources: plan.md (2026-09-30)");
  const ok = await new AnswerPipeline("u", kb, [bad, slow, good]).answer("launch date?", "Priya", meeting(), {}, { now: NOW });
  assert.equal(ok.modelId, "big");
  assert.equal(ok.status, "answered");
  assert.equal(bad.seen.length, 1); // format failure is not retried on the same model
  const none = await new AnswerPipeline("u", kb, [bad, slow]).answer("launch date?", "Priya", meeting(), {}, { now: NOW });
  assert.equal(none.text, UNAVAILABLE);
  kb.close();
  rmSync(dir, { recursive: true });
});

test("output format validator", () => {
  assert.equal(checkAnswer("- A\n- B\n— sources: a.md (2026-10-01)").ok, true);
  assert.equal(checkAnswer("Launch is Oct 14. Owner is Varish.\n— sources: a.md (2026-10-01)").ok, true);
  assert.equal(checkAnswer("<think>hmm</think>\n- A\n— sources: a.md (x)").ok, true);
  assert.equal(checkAnswer("- A\n- B\n- C\n- D\n— sources: a.md").ok, false);
  assert.equal(checkAnswer("- A").ok, false);
  assert.equal(checkAnswer("One. Two. Three.\n— sources: a.md").ok, false);
  const nothing = checkAnswer("Nothing in your notes on this.");
  assert.ok(nothing.ok && nothing.nothing && nothing.text === NOTHING);
  const red = checkAnswer("- Use password: hunter2 for staging\n— sources: a.md");
  assert.ok(red.ok && !red.text.includes("hunter2"));
});

test("floating model aliases are rejected", () => {
  const base = { provider: "openai-compatible" as const, baseUrl: "http://x", contextWindow: 8192, temperature: 0, maxTokens: 200, timeoutMs: 5000 };
  assert.throws(() => createLLM({ ...base, model: "llama3.2:latest" }), /pin an exact version/);
  assert.doesNotThrow(() => createLLM({ ...base, model: "qwen3:1.7b" }));
});

test("budget: never over, keeps question and newest live line, drops lowest-ranked first", () => {
  const big = (n: number) => "x".repeat(n);
  const a = assemble({
    system: big(4000),
    question: "what is the launch date?",
    recentLive: Array.from({ length: 400 }, (_, i) => `[t${i}] line ${i} ${big(200)}`),
    meetingSummary: big(20_000),
    retrieved: Array.from({ length: 40 }, (_, i) => ({ text: `<passage>${i} ${big(900)}</passage>`, score: 1 - i / 100 })),
    pastSegments: Array.from({ length: 40 }, (_, i) => ({ text: `<past>${i} ${big(900)}</past>`, score: 0.5 - i / 100 })),
    seriesSummary: big(50_000),
    rollupSummary: big(50_000),
  });
  assert.ok(a.tokens <= inputBudget(DEFAULT_BUDGET));
  assert.match(a.recentLive.at(-1)!, /line 399/);
  assert.match(a.retrieved[0], /<passage>0 /);
  assert.ok(!a.retrieved.some((r) => r.includes("<passage>39 ")));
  assert.ok(estimateTokens(a.seriesSummary) < 50_000 / 3.2);
});
