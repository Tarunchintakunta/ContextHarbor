import { test } from "node:test";
import assert from "node:assert/strict";
import { weekOf, parseKbPath, timeHintWeeks } from "./weeks";

test("ISO week folders match the brief's examples and year boundaries", () => {
  assert.equal(weekOf("2026-10-02").folder, "2026/W40_2026-09-28_to_2026-10-04");
  assert.equal(weekOf("2026-09-22").folder, "2026/W39_2026-09-21_to_2026-09-27");
  assert.equal(weekOf("2027-01-01").key, "2026-W53"); // Friday belongs to 2026's last ISO week
  assert.equal(weekOf("2024-12-30").key, "2025-W01");
});

test("path metadata: week folder, meetings subfolder, reference, loose dated file", () => {
  assert.deepEqual(parseKbPath("2026/W40_2026-09-28_to_2026-10-04/incident-report-2026-10-01.md"), {
    week: "2026-W40", date: "2026-10-01", docType: "note",
  });
  assert.deepEqual(parseKbPath("2026/W40_2026-09-28_to_2026-10-04/meetings/2026-10-02_sprint-sync/transcript.md"), {
    week: "2026-W40", date: "2026-10-02", docType: "meeting",
  });
  assert.deepEqual(parseKbPath("2026/W39_2026-09-21_to_2026-09-27/design-review-payments.pdf").date, "2026-09-21");
  assert.deepEqual(parseKbPath("_reference/resume.md"), { week: null, date: null, docType: "reference" });
  assert.equal(parseKbPath("inbox/notes-2026-09-30.md").week, "2026-W40");
});

test("time hints map to week keys", () => {
  const now = new Date("2026-10-02T12:00:00Z"); // Friday, W40
  assert.deepEqual(timeHintWeeks("what did we decide last week?", now), ["2026-W39"]);
  assert.deepEqual(timeHintWeeks("status this week", now), ["2026-W40"]);
  assert.deepEqual(timeHintWeeks("what happened on Tuesday", now), ["2026-W40"]);
  assert.deepEqual(timeHintWeeks("on Friday", now), ["2026-W39"]); // most recent past Friday
  assert.deepEqual(timeHintWeeks("notes from 2026-09-22", now), ["2026-W39"]);
  assert.ok(timeHintWeeks("in August", now)!.includes("2026-W33"));
  assert.equal(timeHintWeeks("what is the API latency?", now), null);
});
