// Fixed per-request token budget and priority-ordered assembly (brief: <context_management>).

export interface BudgetConfig {
  contextWindow: number; // pinned model's window
  maxInputTokens: number; // hard cap, e.g. 12_000 for cheap models
  outputTokens: number; // reserved answer space
  shares: { system: number; live: number; retrieved: number; past: number };
}

export const DEFAULT_BUDGET: BudgetConfig = {
  contextWindow: 32_768,
  maxInputTokens: 12_000,
  outputTokens: 300,
  shares: { system: 0.15, live: 0.35, retrieved: 0.3, past: 0.2 },
};

// ponytail: safe overestimate (~3.2 chars/token); swap in the provider tokenizer when one is exposed.
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.2);

export function inputBudget(c: BudgetConfig) {
  return Math.min(c.maxInputTokens, Math.floor(c.contextWindow * 0.5)) - c.outputTokens;
}

export interface Ranked {
  text: string;
  score: number;
}

export interface AssembleInput {
  system: string;
  question: string; // never dropped
  recentLive: string[]; // newest last; never fully dropped
  meetingSummary: string;
  retrieved: Ranked[]; // KB passages and past segments, already rendered
  pastSegments: Ranked[];
  seriesSummary: string;
  rollupSummary: string; // monthly/quarterly, only for far-back questions
}

export interface Assembled {
  recentLive: string[];
  meetingSummary: string;
  retrieved: string[];
  pastSegments: string[];
  seriesSummary: string;
  rollupSummary: string;
  tokens: number;
  budget: number;
}

export class BudgetError extends Error {}

/**
 * Priority: question, recent live context, running summary, top retrieved items, series summary, rollup.
 * Over budget: drop lowest-ranked retrieved items, then shorten summaries; never the question or newest live lines.
 */
export function assemble(inp: AssembleInput, cfg: BudgetConfig = DEFAULT_BUDGET): Assembled {
  const budget = inputBudget(cfg);
  const sysT = estimateTokens(inp.system);
  if (sysT > budget * 0.5) throw new BudgetError("system prompt exceeds half the input budget");
  const rest = budget - sysT - estimateTokens(inp.question) - 64; // 64: section tags
  const share = (n: number) => Math.floor(rest * (n / (1 - cfg.shares.system)));

  // Live: newest lines first until the live share is full (always keep at least the newest line, clipped).
  const liveCap = share(cfg.shares.live);
  const live: string[] = [];
  let used = 0;
  for (let i = inp.recentLive.length - 1; i >= 0; i--) {
    const t = estimateTokens(inp.recentLive[i]);
    if (used + t > liveCap) {
      if (!live.length) live.unshift(clip(inp.recentLive[i], liveCap));
      break;
    }
    live.unshift(inp.recentLive[i]);
    used += t;
  }
  let meetingSummary = clip(inp.meetingSummary, Math.floor(liveCap * 0.4));
  used += estimateTokens(meetingSummary);

  const retrievedCap = share(cfg.shares.retrieved);
  const pastCap = share(cfg.shares.past);
  // Retrieved KB passages and past segments compete on score; past segments may also use the past share.
  const merged = [
    ...inp.retrieved.map((r) => ({ ...r, kind: "kb" as const })),
    ...inp.pastSegments.map((r) => ({ ...r, kind: "past" as const })),
  ].sort((a, b) => b.score - a.score);
  const retrieved: string[] = [];
  const pastSegments: string[] = [];
  let rUsed = 0;
  for (const m of merged) {
    const t = estimateTokens(m.text);
    if (rUsed + t > retrievedCap + Math.floor(pastCap / 2)) continue; // lowest-ranked dropped first
    (m.kind === "kb" ? retrieved : pastSegments).push(m.text);
    rUsed += t;
  }
  const leftForSummaries = Math.max(0, pastCap - Math.max(0, rUsed - retrievedCap));
  const seriesSummary = clip(inp.seriesSummary, Math.floor(leftForSummaries * 0.6));
  const rollupSummary = clip(inp.rollupSummary, leftForSummaries - estimateTokens(seriesSummary));

  const total =
    sysT + estimateTokens(inp.question) + 64 + used + rUsed + estimateTokens(seriesSummary) + estimateTokens(rollupSummary);
  if (total > budget) {
    // Only reachable when summaries alone overflow; shorten the meeting summary as last resort.
    meetingSummary = clip(meetingSummary, Math.max(0, estimateTokens(meetingSummary) - (total - budget)));
  }
  const tokens =
    sysT + estimateTokens(inp.question) + 64 + estimateTokens(live.join("\n")) + estimateTokens(meetingSummary) + rUsed +
    estimateTokens(seriesSummary) + estimateTokens(rollupSummary);
  if (tokens > budget) throw new BudgetError(`assembled ${tokens} > budget ${budget}`);
  return { recentLive: live, meetingSummary, retrieved, pastSegments, seriesSummary, rollupSummary, tokens, budget };
}

function clip(s: string, maxTokens: number) {
  if (maxTokens <= 0 || !s) return "";
  const maxChars = Math.floor(maxTokens * 3.2);
  return s.length <= maxChars ? s : `${s.slice(0, Math.max(0, maxChars - 1))}…`;
}
