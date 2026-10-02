import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./detect";
import { choosePlacement, exclusionSupport } from "./placement";
import { VadSegmenter, RATE, wav } from "./stt";
import { applyPatch } from "./settings";

test("meeting detection needs an in-call process or meeting window; audio alone never triggers", () => {
  assert.equal(classify(["Spotify"], [], true).active, false);
  assert.equal(classify(["zoom.us"], [], true).active, false); // app open, no call
  const z = classify(["zoom.us", "CptHost"], [], false);
  assert.ok(z.active && z.app === "Zoom");
  const meet = classify(["Google Chrome"], [{ id: "w1", title: "Meet - abc-defg-hij - Google Chrome" }], true);
  assert.ok(meet.active && meet.app === "Google Meet" && meet.windowId === "w1");
  const teams = classify(["MSTeams"], [{ id: "w2", title: "Sprint sync | Microsoft Teams" }, { id: "w3", title: "Sharing control bar" }], true);
  assert.equal(teams.active, false); // title lacks Meeting/Call keyword
  const teamsCall = classify(["MSTeams"], [{ id: "w2", title: "Meeting with Priya | Microsoft Teams" }, { id: "w3", title: "Sharing control bar" }], true);
  assert.ok(teamsCall.active && teamsCall.sharing);
});

test("placement: never on the likely shared display without verified exclusion", () => {
  const one = [{ id: 1, primary: true, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
  const two = [...one, { id: 2, primary: false, bounds: { x: 1512, y: 0, width: 1920, height: 1080 } }];
  const base = { platform: "darwin" as const, osRelease: "25.0.0", mode: "auto" as const, trustCaptureExclusion: false };
  assert.deepEqual(choosePlacement({ ...base, displays: two, sharing: true }).displayId, 2);
  assert.equal(choosePlacement({ ...base, displays: one, sharing: true }).show, false);
  assert.equal(choosePlacement({ ...base, displays: one, sharing: true, trustCaptureExclusion: true }).show, true);
  assert.equal(choosePlacement({ ...base, platform: "win32", osRelease: "10.0.22631", displays: one, sharing: true }).show, true);
  assert.equal(choosePlacement({ ...base, platform: "linux", osRelease: "6.8", displays: one, sharing: true }).show, false);
  assert.equal(choosePlacement({ ...base, displays: one, sharing: false }).show, true);
  assert.equal(exclusionSupport("win32", "10.0.18363"), "unsupported");
});

test("VAD segments speech and ignores silence", () => {
  const segs: number[] = [];
  const v = new VadSegmenter("remote", (s) => segs.push(s.pcm.length));
  const frame = (amp: number) => Int16Array.from({ length: RATE / 10 }, (_, i) => Math.round(amp * 32767 * Math.sin(i / 3)));
  for (let i = 0; i < 20; i++) v.push(frame(0)); // 2 s silence: nothing buffered
  for (let i = 0; i < 15; i++) v.push(frame(0.2)); // 1.5 s speech
  for (let i = 0; i < 8; i++) v.push(frame(0)); // 0.8 s silence ends the segment
  assert.equal(segs.length, 1);
  assert.ok(segs[0] >= 1.5 * RATE);
  assert.equal(wav(new Int16Array(10)).length, 64);
});

test("settings patch validation rejects junk", () => {
  const s = { hotkeys: { pause: "A", ask: "B", toggle: "C", pin: "D", dismiss: "E" }, policy: { organization: "not_set", consentConfirmed: false, allPartyConsent: true, blockedTitlePattern: "exam" }, retention: { transcriptDays: 30, answerHistoryDays: 30 }, display: { mode: "auto", trustCaptureExclusion: false }, profile: { names: ["v"], roles: [], ownedTopics: [] }, autoHideSeconds: 25 } as never;
  const out = applyPatch(s, { policy: { organization: "root" }, hotkeys: { pause: "Cmd+Alt+P; rm -rf" }, retention: { transcriptDays: -1 }, autoHideSeconds: 1 });
  assert.equal((out as { policy: { organization: string } }).policy.organization, "not_set");
  assert.equal((out as { hotkeys: { pause: string } }).hotkeys.pause, "A");
  assert.equal((out as { retention: { transcriptDays: number } }).retention.transcriptDays, 30);
  assert.throws(() => applyPatch(s, null));
});
