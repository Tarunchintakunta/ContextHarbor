// Post-meeting memory: meeting summary, indexed segments, recurring-series summary, monthly/quarterly rollups.
// Runs in the background after a meeting; never blocks a live answer.
import type { KnowledgeBase } from "./kb";
import type { LiveContextBuffer } from "./live";
import { estimateTokens } from "./budget";
import { weekOf } from "./weeks";

export interface Summarizer {
  /** Returns a summary no longer than `capTokens`. `kind` selects the instruction. */
  summarize(kind: "meeting" | "series" | "rollup" | "running", text: string, capTokens: number): Promise<string>;
}

const SIGNAL = /\b(decid|agree|action|todo|owner|due|deadline|will|blocked|risk|open question|\?|launch|ship|release|resolved|done|\d)/i;

/** Deterministic extractive fallback used when no model is available (and in tests). */
export class ExtractiveSummarizer implements Summarizer {
  async summarize(_kind: string, text: string, capTokens: number) {
    const lines = text.split("\n").map((l) => l.replace(/^\[\d\d:\d\d:\d\d\]\s*/, "").trim()).filter(Boolean);
    const picked = lines.filter((l) => SIGNAL.test(l));
    const out: string[] = [];
    let used = 0;
    // Newest signal lines win when over the cap (most recent information is trusted first).
    for (let i = picked.length - 1; i >= 0; i--) {
      const t = estimateTokens(picked[i]) + 1;
      if (used + t > capTokens) break;
      out.unshift(`- ${picked[i]}`);
      used += t;
    }
    return out.join("\n");
  }
}

/** Uses the pinned cheap model through any LLM adapter; falls back to extractive on failure. */
export class ModelSummarizer implements Summarizer {
  private fallback = new ExtractiveSummarizer();
  constructor(private gen: (system: string, user: string, maxTokens: number) => Promise<string>) {}
  async summarize(kind: Parameters<Summarizer["summarize"]>[0], text: string, capTokens: number) {
    const instructions: Record<string, string> = {
      meeting: "Summarize this meeting: decisions, action items with owners and due dates, open questions, key numbers. Bullets only. Use only the text given.",
      running: "Update the running summary of the meeting so far with the new transcript lines: decisions, open questions, action items, numbers, who said what. Bullets only.",
      series: "Update the series summary of this recurring meeting with the latest occurrence: running decisions, open action items, what changed this week. Mark completed items as (resolved) and drop resolved items older than a month. Bullets only, dated.",
      rollup: "Combine these summaries into one shorter summary for the period. Keep decisions, unresolved action items, and key numbers with dates. Bullets only.",
    };
    try {
      const s = await this.gen(instructions[kind], text, Math.min(capTokens, 1200));
      return estimateTokens(s) <= capTokens ? s : this.fallback.summarize(kind, s, capTokens);
    } catch {
      return this.fallback.summarize(kind, text, capTokens);
    }
  }
}

export const CAPS = { running: 600, meeting: 500, series: 800, monthly: 900, quarterly: 1200 };

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "meeting";

export function meetingFolder(m: { title: string; startedAt: number }) {
  const date = new Date(m.startedAt).toISOString().slice(0, 10);
  return `${weekOf(date).folder}/meetings/${date}_${slug(m.title)}`;
}

/** Persisted summaries live in a small key-value store (encrypted by the caller's store). */
export interface SummaryStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  keys(prefix: string): string[];
}

export class MeetingMemory {
  constructor(private userId: string, private kb: KnowledgeBase, private store: SummaryStore, private sum: Summarizer) {}

  /** Folds items that left the verbatim window into the running summary (background, during the meeting). */
  async updateRunning(live: LiveContextBuffer, now = Date.now()) {
    const pending = live.pendingForSummary(now);
    if (!pending.length) return;
    const text = `${live.summary}\n${pending.map((i) => `${i.speaker ?? i.kind}: ${i.text}`).join("\n")}`;
    live.commitSummary(await this.sum.summarize("running", text, CAPS.running), pending.length);
  }

  /** Called when the meeting ends and the policy allows saving. Returns the folder used. */
  async finalize(live: LiveContextBuffer) {
    const folder = meetingFolder(live.meta);
    const date = new Date(live.meta.startedAt).toISOString().slice(0, 10);
    const transcript = live.toMarkdown();
    await this.kb.upsertDocument(this.userId, `${folder}/transcript.md`, transcript, { title: `${live.meta.title} (${date})`, date, docType: "meeting" });
    const summary = await this.sum.summarize("meeting", transcript, CAPS.meeting);
    this.store.set(`meeting:${folder}`, summary);
    await this.kb.upsertDocument(this.userId, `${folder}/summary.md`, summary, { title: `${live.meta.title} summary (${date})`, date, docType: "meeting" });

    const series = live.meta.seriesId ?? slug(live.meta.title);
    const prev = this.store.get(`series:${series}`) ?? "";
    this.store.set(`series:${series}`, await this.sum.summarize("series", `${prev}\n\n## ${date}\n${summary}`, CAPS.series));
    await this.rollup(date);
    return folder;
  }

  seriesSummary(seriesIdOrTitle: string) {
    return this.store.get(`series:${seriesIdOrTitle}`) ?? this.store.get(`series:${slug(seriesIdOrTitle)}`) ?? "";
  }

  /** Monthly = weekly meeting summaries of the month; quarterly = its months. Each layer re-summarized under its cap. */
  async rollup(date: string) {
    const month = date.slice(0, 7);
    const monthText = this.store
      .keys("meeting:")
      .filter((k) => k.includes(`/meetings/${month}`))
      .sort()
      .map((k) => `## ${k.split("/").pop()}\n${this.store.get(k)}`)
      .join("\n\n");
    this.store.set(`monthly:${month}`, await this.sum.summarize("rollup", monthText, CAPS.monthly));
    const [y, m] = month.split("-").map(Number);
    const q = Math.floor((m - 1) / 3);
    const months = [0, 1, 2].map((i) => `${y}-${String(q * 3 + i + 1).padStart(2, "0")}`);
    const qText = months.map((mm) => this.store.get(`monthly:${mm}`)).filter(Boolean).map((s, i) => `## ${months[i]}\n${s}`).join("\n\n");
    this.store.set(`quarterly:${y}-Q${q + 1}`, await this.sum.summarize("rollup", qText, CAPS.quarterly));
  }

  rollupFor(date: string) {
    const month = date.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    return [this.store.get(`monthly:${month}`), this.store.get(`quarterly:${y}-Q${Math.floor((m - 1) / 3) + 1}`)].filter(Boolean).join("\n\n");
  }
}

export class MemoryStore implements SummaryStore {
  private m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k);
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
  keys(prefix: string) {
    return [...this.m.keys()].filter((k) => k.startsWith(prefix));
  }
}
