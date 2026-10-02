// Live context buffer for the current meeting: timestamped speech, chat, shared-screen text and metadata.
// Holds the full meeting in memory; the LLM only ever sees a budgeted slice.
import { tokens } from "./embed";

export type ItemKind = "speech" | "chat" | "screen" | "meta";

export interface LiveItem {
  t: number; // epoch ms
  kind: ItemKind;
  speaker?: string; // "me", "remote", or a diarized/participant label
  text: string;
}

export interface MeetingMeta {
  id: string;
  title: string;
  app: string;
  startedAt: number;
  participants: string[];
  seriesId?: string;
}

export class LiveContextBuffer {
  readonly items: LiveItem[] = [];
  /** Running summary of everything older than the verbatim window. */
  summary = "";
  private summarizedUpTo = 0; // items before this index are folded into `summary`
  private lastScreenText = "";

  constructor(readonly meta: MeetingMeta, private verbatimMs = 5 * 60_000) {}

  add(item: LiveItem) {
    const text = item.text.trim();
    if (!text) return false;
    // Shared-screen OCR repeats while a slide stays up; keep only changes.
    if (item.kind === "screen") {
      if (similarity(text, this.lastScreenText) > 0.9) return false;
      this.lastScreenText = text;
    }
    this.items.push({ ...item, text });
    return true;
  }

  recent(now = Date.now()): LiveItem[] {
    return this.items.filter((i) => i.t >= now - this.verbatimMs);
  }

  /** Items that fell out of the verbatim window and are not yet summarized. */
  pendingForSummary(now = Date.now()): LiveItem[] {
    const cutoff = now - this.verbatimMs;
    const out: LiveItem[] = [];
    for (let i = this.summarizedUpTo; i < this.items.length && this.items[i].t < cutoff; i++) out.push(this.items[i]);
    return out;
  }

  /** Called by the background summarizer after folding `count` pending items into a new summary. */
  commitSummary(summary: string, count: number) {
    this.summary = summary;
    this.summarizedUpTo += count;
  }

  /** Earlier moments of this meeting matching the question (e.g. a number said 20 minutes ago). */
  earlierMatches(question: string, now = Date.now(), k = 4): LiveItem[] {
    const q = new Set(tokens(question));
    if (!q.size) return [];
    const cutoff = now - this.verbatimMs;
    return this.items
      .filter((i) => i.t < cutoff)
      .map((i) => ({ i, s: tokens(i.text).filter((w) => q.has(w)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.i.t - a.i.t)
      .slice(0, k)
      .map((x) => x.i)
      .sort((a, b) => a.t - b.t);
  }

  /** Full transcript for saving (subject to policy) and indexing. */
  toMarkdown(): string {
    const head = `# ${this.meta.title}\n\nApp: ${this.meta.app}\nStarted: ${new Date(this.meta.startedAt).toISOString()}\nParticipants: ${this.meta.participants.join(", ") || "unknown"}\n`;
    return `${head}\n${this.items.map(formatItem).join("\n")}\n`;
  }
}

export function formatItem(i: LiveItem) {
  const ts = new Date(i.t).toISOString().slice(11, 19);
  const who = i.kind === "speech" ? `${i.speaker ?? "unknown"}: ` : i.kind === "chat" ? `[chat] ${i.speaker ?? ""}: ` : i.kind === "screen" ? "[shared screen] " : "[meta] ";
  return `[${ts}] ${who}${i.text}`;
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.max(1, Math.max(A.size, B.size));
}
