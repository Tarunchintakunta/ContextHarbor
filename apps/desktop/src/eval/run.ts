// Runs the evaluation set against candidate models (3 rounds each) and writes a report.
// Usage: node dist/eval/run.js [--rounds 3] [--models qwen3:1.7b,gemma3:1b] [--base http://127.0.0.1:11434/v1]
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { CASES, type EvalCase } from "./cases";
import { createLLM, type ModelConfig } from "../core/llm";
import { SYSTEM_PROMPT, buildUserMessage, checkAnswer, renderPassage } from "../core/prompt";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROUNDS = Number(arg("rounds", "3"));
const BASE = arg("base", "http://127.0.0.1:11434/v1");
const MODELS = arg("models", "gemma3:1b,qwen3:1.7b,llama3.2:3b,phi3:3.8b,qwen2.5:7b").split(",");
const LATENCY_MS = 3000;

function message(c: EvalCase) {
  return buildUserMessage(c.question, c.askedBy, {
    recentLive: c.live,
    meetingSummary: "",
    retrieved: c.passages.map((p) => renderPassage({ sourcePath: p.source, date: p.date, text: p.text })),
    pastSegments: [],
    seriesSummary: "",
    rollupSummary: "",
    tokens: 0,
    budget: 0,
  });
}

const nums = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, "").replace(/^0+(?=\d)/, "")));

export function grade(c: EvalCase, raw: string) {
  const chk = checkAnswer(raw, c.passages.map((p) => p.source));
  if (!chk.ok) return { format: false, correct: false, invented: false, why: `format: ${chk.reason}` };
  if (c.expect.nothing) return { format: true, correct: chk.nothing, invented: false, why: chk.nothing ? "" : "should abstain" };
  if (chk.nothing) return { format: true, correct: !!c.expect.allowNothing, invented: false, why: c.expect.allowNothing ? "" : "abstained on answerable case" };
  const lines = chk.text.split("\n").filter((l) => !/^— sources:/.test(l));
  // Time-hint cases grade the key fact (first line); mentioning the newer value afterwards is allowed by Part 2 §6a.
  const body = c.category === "time" ? lines[0] : lines.join(" ");
  const lower = body.toLowerCase();
  const hit = c.expect.mustAny.every((group) => group.some((g) => lower.includes(g.toLowerCase())));
  const leak = (c.expect.mustNot ?? []).find((m) => lower.includes(m.toLowerCase()));
  const inputNums = nums(`${c.question} ${c.live.join(" ")} ${c.passages.map((p) => `${p.text} ${p.date} ${p.source}`).join(" ")}`);
  const invented = [...nums(lines.join(" "))].filter((n) => !inputNums.has(n));
  return {
    format: true,
    correct: hit && !leak,
    invented: invented.length > 0,
    why: !hit ? "missing expected fact" : leak ? `included distractor "${leak}"` : invented.length ? `invented numbers ${invented.join(",")}` : "",
  };
}

const CHAIN = process.argv.includes("--chain");

/** Runs the models as the app does: first model whose output passes the format check wins. */
async function chainEval() {
  const llms = MODELS.map((model) => createLLM({ provider: "openai-compatible", model, baseUrl: BASE, contextWindow: 32_768, temperature: 0, maxTokens: 200, timeoutMs: 20_000 }));
  for (const l of llms) await l.generate({ system: SYSTEM_PROMPT, messages: [{ role: "user", content: message(CASES[0]) }], maxTokens: 20, timeoutMs: 120_000 });
  const rows: { id: string; ok: boolean; why: string; used: string; ms: number }[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    for (const c of CASES) {
      const t0 = Date.now();
      let used = "none";
      let g = { format: false, correct: false, invented: false, why: "all models failed format" };
      for (const l of llms) {
        const r = await l.generate({ system: SYSTEM_PROMPT, messages: [{ role: "user", content: message(c) }], maxTokens: 200, timeoutMs: 20_000 }).catch(() => null);
        if (!r || !checkAnswer(r.text, c.passages.map((p) => p.source)).ok) continue;
        used = l.id;
        g = grade(c, r.text);
        break;
      }
      rows.push({ id: c.id, ok: g.format && g.correct && !g.invented, why: g.why, used, ms: Date.now() - t0 });
    }
  }
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const summary = {
    chain: MODELS.join(" -> "), cases: CASES.length, rounds: ROUNDS, passRate: rows.filter((r) => r.ok).length / rows.length,
    fallbackUsed: rows.filter((r) => r.used !== llms[0].id).length, totalP50: ms[Math.floor(ms.length / 2)], totalP95: ms[Math.ceil(ms.length * 0.95) - 1],
    failing: rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.why}`),
  };
  console.log(JSON.stringify(summary));
  const out = path.join(process.cwd(), "..", "..", "evidence", "eval");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `chain-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ summary, rows }, null, 2));
}

async function main() {
  if (CHAIN) return chainEval();
  const report: Record<string, unknown>[] = [];
  for (const model of MODELS) {
    const cfg: ModelConfig = {
      provider: "openai-compatible", model, baseUrl: BASE, contextWindow: 32_768, temperature: 0, maxTokens: 200, timeoutMs: 20_000,
      extraBody: model.startsWith("qwen3") ? { reasoning_effort: "none" } : undefined,
    };
    const llm = createLLM(cfg);
    // Warm-up (model load) is excluded from latency; cold start reported separately.
    const cold = Date.now();
    try {
      await llm.generate({ system: SYSTEM_PROMPT, messages: [{ role: "user", content: message(CASES[0]) }], maxTokens: 50, timeoutMs: 120_000 });
    } catch (e) {
      console.error(`${model}: warm-up failed: ${(e as Error).message}`);
      report.push({ model, error: "unavailable" });
      continue;
    }
    const coldMs = Date.now() - cold;
    const rows: { id: string; round: number; ok: boolean; format: boolean; correct: boolean; invented: boolean; error: boolean; firstMs: number; why: string; out: string }[] = [];
    for (let round = 1; round <= ROUNDS; round++) {
      for (const c of CASES) {
        const t0 = Date.now();
        let first = 0;
        try {
          const r = await llm.generate({
            system: SYSTEM_PROMPT, messages: [{ role: "user", content: message(c) }], maxTokens: 200, timeoutMs: 20_000,
            stream: () => { first ||= Date.now() - t0; },
          });
          const g = grade(c, r.text);
          rows.push({ id: c.id, round, ...g, error: false, firstMs: first || r.totalMs, ok: g.format && g.correct && !g.invented, out: r.text.slice(0, 300) });
        } catch (e) {
          rows.push({ id: c.id, round, ok: false, format: false, correct: false, invented: false, error: true, firstMs: Date.now() - t0, why: (e as Error).message, out: "" });
        }
      }
      process.stdout.write(`${model} round ${round} done\n`);
    }
    const lat = rows.map((r) => r.firstMs).sort((a, b) => a - b);
    const pct = (p: number) => lat[Math.min(lat.length - 1, Math.ceil(lat.length * p) - 1)];
    const failing = [...new Set(rows.filter((r) => !r.ok).map((r) => r.id))];
    const summary = {
      model,
      cases: CASES.length,
      rounds: ROUNDS,
      passRate: rows.filter((r) => r.ok).length / rows.length,
      formatRate: rows.filter((r) => r.format).length / rows.length,
      inventedCount: rows.filter((r) => r.invented).length,
      abstainCorrect: rows.filter((r) => CASES.find((c) => c.id === r.id)!.expect.nothing && r.correct).length,
      abstainTotal: rows.filter((r) => CASES.find((c) => c.id === r.id)!.expect.nothing).length,
      errors: rows.filter((r) => r.error).length,
      firstTokenP50: pct(0.5),
      firstTokenP95: pct(0.95),
      coldStartMs: coldMs,
      consistent: CASES.every((c) => new Set(rows.filter((r) => r.id === c.id).map((r) => r.ok)).size === 1),
      failing,
      verdict: "",
      failures: rows.filter((r) => !r.ok).slice(0, 12).map((r) => ({ id: r.id, round: r.round, why: r.why, out: r.out })),
    };
    summary.verdict =
      summary.formatRate === 1 && summary.inventedCount === 0 && summary.passRate === 1 && summary.errors === 0 && summary.firstTokenP95 <= LATENCY_MS
        ? "PASS"
        : "FAIL";
    console.log(`${model}: ${summary.verdict} pass=${(summary.passRate * 100).toFixed(1)}% format=${(summary.formatRate * 100).toFixed(1)}% invented=${summary.inventedCount} errors=${summary.errors} p50=${summary.firstTokenP50}ms p95=${summary.firstTokenP95}ms failing=${failing.join(",")}`);
    report.push(summary);
  }
  const out = path.join(process.cwd(), "..", "..", "evidence", "eval");
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(path.join(out, `eval-${stamp}.json`), JSON.stringify({ date: new Date().toISOString(), base: BASE, latencyTargetMs: LATENCY_MS, report }, null, 2));
  console.log(`report: evidence/eval/eval-${stamp}.json`);
}

if (require.main === module) void main();
