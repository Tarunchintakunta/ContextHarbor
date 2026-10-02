// Decides whether a finalized utterance is a question aimed at the user (Part 2, Section 3).
// Conservative by design: when unsure, stay quiet; the manual hotkey covers misses.

export interface Profile {
  names: string[]; // name, nicknames
  roles: string[]; // e.g. "backend team", "payments lead"
  ownedTopics: string[]; // topics the user owns
}

export interface Turn {
  speaker: string; // "me" for the user's own channel
  text: string;
}

export interface DetectContext {
  profile: Profile;
  previous?: Turn; // the turn right before this one
  participantCount?: number; // 2 = one-on-one
}

export type Verdict = { directed: boolean; reason: string };

const QUESTION_WORDS = /^(what|when|where|who|whom|which|why|how|is|are|was|were|do|does|did|can|could|would|will|should|shall|have|has|any|anything)\b/i;
const REQUEST = /\b(can|could|would|will) (you|your team)\b|\b(tell|walk|give|update|share with) (us|me)\b|\bwhat('s| is) (the )?(status|update|eta|timeline|plan)\b/i;
const RHETORICAL = /\b(right|isn'?t it|aren'?t we|don'?t you think|you know what i mean|who knows|why not|how about that|guess what)\s*\?*\s*$/i;
const YOU = /\b(you|your|yours)\b/i;

export function isQuestion(text: string) {
  const t = text.trim();
  return t.endsWith("?") || QUESTION_WORDS.test(t) || REQUEST.test(t);
}

export function detectDirected(turn: Turn, ctx: DetectContext): Verdict {
  const text = turn.text.trim();
  const lower = text.toLowerCase();
  if (turn.speaker === "me") return { directed: false, reason: "user's own speech" };
  if (!isQuestion(text)) return { directed: false, reason: "not a question" };
  if (RHETORICAL.test(text)) return { directed: false, reason: "rhetorical" };

  const mentions = (list: string[]) => list.find((n) => n && new RegExp(`\\b${escape(n.toLowerCase())}\\b`).test(lower));
  const name = mentions(ctx.profile.names);
  if (name) return { directed: true, reason: `addressed by name (${name})` };
  const role = mentions(ctx.profile.roles);
  if (role) return { directed: true, reason: `addressed by role (${role})` };

  // Addressed to someone else by name at the start ("Priya, can you...") -> not ours.
  if (/^[A-Z][a-z]+,\s/.test(text)) return { directed: false, reason: "addressed to someone else" };

  if (ctx.previous?.speaker === "me" && (YOU.test(text) || REQUEST.test(text) || /^(and|so|but|what about|how about)\b/i.test(text))) {
    return { directed: true, reason: "follow-up to the user" };
  }
  const topic = mentions(ctx.profile.ownedTopics);
  if (topic && (YOU.test(text) || REQUEST.test(text))) return { directed: true, reason: `user-owned topic (${topic})` };
  if ((ctx.participantCount ?? 99) <= 2 && YOU.test(text)) return { directed: true, reason: "one-on-one 'you'" };
  return { directed: false, reason: "not clearly aimed at the user" };
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
