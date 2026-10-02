// Question -> standalone query -> retrieval (user-scoped) -> budgeted request -> LLM chain -> validated answer.
import { assemble, DEFAULT_BUDGET, type BudgetConfig, BudgetError } from "./budget";
import { type KnowledgeBase, type Passage, assertOwned, requireUser, IsolationError } from "./kb";
import { type LiveContextBuffer, formatItem } from "./live";
import { type LLM, LLMError, runChain } from "./llm";
import { SYSTEM_PROMPT, NOTHING, buildUserMessage, checkAnswer, renderPassage } from "./prompt";
import { timeHintWeeks } from "./weeks";
import { tokens } from "./embed";

export interface Answer {
  text: string; // validated Section 10 output, or NOTHING / UNAVAILABLE
  status: "answered" | "nothing" | "unavailable" | "isolation_blocked";
  modelId: string | null;
  sources: { file: string; date: string | null }[];
  timings: { retrievalMs: number; totalMs: number; firstTokenMs?: number };
  requestTokens: number;
  attempts: { modelId: string; error?: string; ms: number }[];
}

export const UNAVAILABLE = "Answer unavailable right now.";
export const ISOLATION_BLOCKED = "Retrieval unavailable: could not verify this knowledge base belongs to you.";

export interface PastContext {
  seriesSummary?: string;
  rollupSummary?: string; // monthly/quarterly; included when the question reaches far back
}

export class AnswerPipeline {
  constructor(
    readonly userId: string,
    private kb: KnowledgeBase,
    private models: LLM[],
    private budget: BudgetConfig = DEFAULT_BUDGET,
    private log: (e: Record<string, unknown>) => void = () => {},
  ) {
    requireUser(userId);
  }

  /** Standalone query: the question plus salient terms from the latest remote turns (pronoun resolution). */
  rewriteQuery(question: string, live: LiveContextBuffer, now: number) {
    // ponytail: heuristic rewrite to stay inside the 2-3 s budget; an LLM rewrite can replace it if recall suffers.
    const q = new Set(tokens(question));
    const recent = live.recent(now).filter((i) => i.kind !== "meta").slice(-4);
    const extra = recent.flatMap((i) => tokens(i.text)).filter((w) => !q.has(w) && w.length > 3);
    const needsContext = /\b(it|that|this|those|they|them|there)\b/i.test(question) || q.size < 4;
    return needsContext ? `${question} ${[...new Set(extra)].slice(-8).join(" ")}` : question;
  }

  async answer(
    question: string,
    askedBy: string,
    live: LiveContextBuffer,
    past: PastContext = {},
    opts: { now?: number; onDelta?: (d: string) => void; onStatus?: (s: string) => void } = {},
  ): Promise<Answer> {
    const now = opts.now ?? Date.now();
    const t0 = Date.now();
    const base = { modelId: null, sources: [], requestTokens: 0, attempts: [] };
    let passages: Passage[];
    let segments: Passage[];
    const slow = setTimeout(() => opts.onStatus?.("looking…"), 800);
    try {
      const query = this.rewriteQuery(question, live, now);
      const weeks = timeHintWeeks(question, new Date(now));
      [passages, segments] = await Promise.all([
        this.kb.search(this.userId, query, { weeks, docTypes: ["note", "reference"], k: 6, now: new Date(now) }),
        this.kb.search(this.userId, query, { weeks, docTypes: ["meeting"], k: 4, now: new Date(now) }),
      ]);
      segments = segments.filter((s) => !s.sourcePath.startsWith(`live:${live.meta.id}`)); // current meeting comes from the buffer
      assertOwned(this.userId, [...passages, ...segments]);
    } catch (e) {
      clearTimeout(slow);
      this.log({ ev: "retrieval_error", kind: e instanceof IsolationError ? "isolation" : "error" });
      const blocked = e instanceof IsolationError;
      return { ...base, text: blocked ? ISOLATION_BLOCKED : UNAVAILABLE, status: blocked ? "isolation_blocked" : "unavailable", timings: { retrievalMs: Date.now() - t0, totalMs: Date.now() - t0 } };
    }
    clearTimeout(slow);
    const retrievalMs = Date.now() - t0;

    const recentLines = live.recent(now).map(formatItem);
    const earlier = live.earlierMatches(question, now).map((i) => `(earlier) ${formatItem(i)}`);
    const farBack = /\b(months? ago|quarter|last year|in (january|february|march|april|may|june|july|august|september|october|november|december))\b/i.test(question);

    const build = (shrink: boolean) => {
      const cfg = shrink ? { ...this.budget, maxInputTokens: Math.floor(this.budget.maxInputTokens * 0.6) } : this.budget;
      const a = assemble(
        {
          system: SYSTEM_PROMPT,
          question: `${askedBy}: ${question}`,
          recentLive: [...earlier, ...recentLines],
          meetingSummary: live.summary,
          retrieved: passages.map((p) => ({ text: renderPassage(p), score: p.score })),
          pastSegments: segments.map((p) => ({ text: renderPassage(p), score: p.score })),
          seriesSummary: past.seriesSummary ?? "",
          rollupSummary: farBack ? past.rollupSummary ?? "" : "",
        },
        cfg,
      );
      return { a, msg: buildUserMessage(question, askedBy, a) };
    };

    let requestTokens = 0;
    let firstTokenMs: number | undefined;
    const outcome = await runChain(
      this.models,
      async (llm, shrink) => {
        let built;
        try {
          built = build(shrink);
        } catch (e) {
          if (e instanceof BudgetError) throw new LLMError(e.message, "context_length");
          throw e;
        }
        requestTokens = built.a.tokens;
        const r = await llm.generate({
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: built.msg }],
          stream: opts.onDelta,
          maxTokens: this.budget.outputTokens,
          timeoutMs: 8_000,
        });
        firstTokenMs = r.firstTokenMs;
        const c = checkAnswer(r.text);
        if (!c.ok) throw new LLMError(`format: ${c.reason}`, "format");
        return c;
      },
      (e) => this.log({ ev: "llm_error", ...e }),
    );

    const totalMs = Date.now() - t0;
    this.log({ ev: "answer", ms: totalMs, retrievalMs, model: outcome.modelId, passages: passages.length });
    if (!outcome.value) {
      return { ...base, text: UNAVAILABLE, status: "unavailable", requestTokens, attempts: outcome.attempts, timings: { retrievalMs, totalMs } };
    }
    const used = [...passages, ...segments];
    return {
      text: outcome.value.text,
      status: outcome.value.nothing ? "nothing" : "answered",
      modelId: outcome.modelId,
      sources: used.map((p) => ({ file: p.sourcePath.split("/").pop() ?? p.sourcePath, date: p.date })),
      timings: { retrievalMs, totalMs, firstTokenMs },
      requestTokens,
      attempts: outcome.attempts,
    };
  }
}

export { NOTHING };
