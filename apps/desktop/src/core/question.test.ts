import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDirected, type DetectContext } from "./question";

const ctx: DetectContext = {
  profile: { names: ["Varish", "V"], roles: ["backend team", "payments lead"], ownedTopics: ["payments migration"] },
  participantCount: 6,
};
const d = (speaker: string, text: string, extra: Partial<DetectContext> = {}) => detectDirected({ speaker, text }, { ...ctx, ...extra }).directed;

test("triggers on name, role, follow-up, owned topic, one-on-one", () => {
  assert.equal(d("remote", "Varish, what's the status on the payments migration?"), true);
  assert.equal(d("remote", "Can the backend team tell us when the API freeze starts?"), true);
  assert.equal(d("remote", "And when does that ship?", { previous: { speaker: "me", text: "We finished the schema change." } }), true);
  assert.equal(d("remote", "Where are you on the payments migration?"), true);
  assert.equal(d("remote", "What did you decide about retries?", { participantCount: 2 }), true);
});

test("stays quiet on rhetorical, other-addressed, own and non-questions", () => {
  assert.equal(d("remote", "That's the whole point, right?"), false);
  assert.equal(d("remote", "Priya, can you share the design doc?"), false);
  assert.equal(d("me", "Varish here, what's the ETA on QA?"), false);
  assert.equal(d("remote", "Let's move to the next item."), false);
  assert.equal(d("remote", "What did you decide about retries?"), false); // big meeting, no addressee
});
