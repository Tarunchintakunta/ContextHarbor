// Builds the model-neutral request (brief: <llm_request_format>) and validates answers (Part 2, Section 10).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Assembled } from "./budget";
import type { Passage } from "./kb";

export const SYSTEM_PROMPT = readFileSync(path.join(__dirname, "..", "..", "static", "system-prompt.md"), "utf8");

export const NOTHING = 'Nothing in your notes on this. Suggest: "Let me check and follow up after the call."';

const esc = (s: string) => s.replace(/</g, "&lt;");
const attr = (s: string) => s.replace(/["<>&]/g, "");

export function renderPassage(p: Pick<Passage, "sourcePath" | "date" | "text">) {
  return `<passage source="${attr(p.sourcePath.split("/").pop() ?? p.sourcePath)}" date="${attr(p.date ?? "undated")}">${esc(p.text)}</passage>`;
}

// Per-request reminder placed last, where small models attend most. The system prompt (Part 2) stays verbatim.
export const FORMAT_REMINDER = `<output_format>
Use only <meeting_context>, <meeting_summary>, <past_meeting_segments> and <retrieved_passages>. If they contain the answer, reply with 1 to 3 bullets starting with "- " (key fact first, no preamble), then one last line "— sources: <file name> (<date>)". For facts said in this meeting, cite "this meeting (<time>)". If they do not contain the answer, reply exactly: ${NOTHING}
</output_format>`;

export function buildUserMessage(question: string, askedBy: string, a: Assembled) {
  const section = (tag: string, body: string) => `<${tag}>\n${body}\n</${tag}>`;
  const parts = [
    section("meeting_context", a.recentLive.map(esc).join("\n")),
    a.meetingSummary && section("meeting_summary", esc(a.meetingSummary)),
    a.seriesSummary && section("series_summary", esc(a.seriesSummary + (a.rollupSummary ? `\n\n${a.rollupSummary}` : ""))),
    a.pastSegments.length ? section("past_meeting_segments", a.pastSegments.join("\n")) : "",
    section("retrieved_passages", a.retrieved.join("\n")), // always present, possibly empty
    section("question", `${esc(askedBy)} asked: ${esc(question)}`),
    FORMAT_REMINDER,
  ];
  return parts.filter(Boolean).join("\n\n");
}

const SECRET = /\b(password|passwd|passcode|pin|api[_ -]?key|secret|token|credentials?)(\s+(?:is|was|=|:)|\s*[:=])\s*[^\s,;]+|\b(?:sk|pk|ghp|xox[abp])-?[A-Za-z0-9_-]{16,}\b|\b\d{3}-\d{2}-\d{4}\b/gi;

export type Checked = { ok: true; text: string; nothing: boolean } | { ok: false; reason: string };

// Meeting citations: "this meeting (14:31)", "meeting chat", "Sam (14:57:50)" — a time, not a date, marks the live meeting.
const LIVE_SOURCE = /^(this (meeting|call)|current meeting|meeting chat|chat|shared screen|slide \d+)\b|\(\d{1,2}:\d{2}(:\d{2})?\)$/i;

/**
 * Enforces Section 10: 1-3 bullets or 1-2 sentences plus a sources line, or the exact "nothing" reply.
 * With `allowedSources`, every cited source must be a provided passage file or the live meeting.
 */
export function checkAnswer(raw: string, allowedSources?: string[]): Checked {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim(); // some local models emit reasoning blocks
  text = text.replace(/^```\w*\n?|\n?```$/g, "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.startsWith("Nothing in your notes on this")) return { ok: true, text: NOTHING, nothing: true };
  text = text.replace(SECRET, (m, word: string | undefined, sep: string | undefined) => (word ? `${word}${sep} [redacted]` : "[redacted]"));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const srcIdx = lines.findIndex((l) => /^[—–-]{1,2}\s*sources?:/i.test(l));
  if (srcIdx === -1) return { ok: false, reason: "missing sources line" };
  if (srcIdx !== lines.length - 1) return { ok: false, reason: "text after sources line" };
  const body = lines.slice(0, srcIdx);
  if (!body.length) return { ok: false, reason: "no answer body" };
  const bullets = body.filter((l) => /^[-*•—–]\s+/.test(l));
  if (bullets.length) {
    if (bullets.length !== body.length || bullets.length > 3) return { ok: false, reason: "1-3 bullets required" };
  } else {
    const sentences = body.join(" ").split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 2) return { ok: false, reason: "more than 2 sentences" };
  }
  if (body.join(" ").length > 400) return { ok: false, reason: "too long" };
  const sources = lines[srcIdx].replace(/^[—–-]{1,2}\s*sources?:\s*/i, "");
  if (!sources) return { ok: false, reason: "empty sources" };
  if (allowedSources) {
    const allowed = allowedSources.map((a) => a.toLowerCase().replace(/\.(md|markdown|txt|pdf|docx)$/, ""));
    const cited = sources.split(/,(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);
    const base = (c: string) => c.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase().replace(/\.(md|markdown|txt|pdf|docx)$/, "");
    const bogus = cited.find((c) => !allowed.includes(base(c)) && !LIVE_SOURCE.test(c));
    if (bogus) return { ok: false, reason: `cites unknown source "${bogus.slice(0, 60)}"` };
  }
  const normalized = body.map((l) => l.replace(/^[*•—–]\s+/, "- "));
  return { ok: true, text: [...normalized, `— sources: ${sources}`].join("\n"), nothing: false };
}
