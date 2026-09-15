import test from "node:test";
import assert from "node:assert/strict";
import { planDraftClaims } from "./planDraftClaims";

const at = (hhmm: string) => new Date(`2026-09-19T${hhmm}:00.000Z`);

test("a draft takes the first session that started after it was opened", () => {
  const plan = planDraftClaims({
    claimants: [{ id: "draft-a", anchor: at("09:00") }],
    sessions: [
      { id: "s-2", instant: at("10:30") },
      { id: "s-1", instant: at("09:20") },
    ],
  });
  assert.deepEqual(plan.claims, [{ claimantId: "draft-a", sessionId: "s-1" }]);
  assert.deepEqual(plan.unclaimedSessionIds, ["s-2"]);
});

test("a session that ran before the draft was opened is never claimed by it", () => {
  const plan = planDraftClaims({
    claimants: [{ id: "draft-a", anchor: at("11:00") }],
    sessions: [{ id: "s-early", instant: at("10:00") }],
  });
  assert.deepEqual(plan.claims, []);
  assert.deepEqual(plan.unclaimedSessionIds, ["s-early"]);
});

test("two open drafts: oldest first, one session each, in time order", () => {
  const plan = planDraftClaims({
    claimants: [
      { id: "draft-late", anchor: at("12:00") },
      { id: "draft-early", anchor: at("09:00") },
    ],
    sessions: [
      { id: "s-3", instant: at("13:00") },
      { id: "s-1", instant: at("09:30") },
      { id: "s-2", instant: at("12:30") },
    ],
  });
  assert.deepEqual(plan.claims, [
    { claimantId: "draft-early", sessionId: "s-1" },
    { claimantId: "draft-late", sessionId: "s-2" },
  ]);
  assert.deepEqual(plan.unclaimedSessionIds, ["s-3"]);
});

test("the older draft's first candidate already taken: it moves to the next session", () => {
  // Two drafts opened before one session: the oldest takes it, the other waits for the next.
  const plan = planDraftClaims({
    claimants: [
      { id: "draft-1", anchor: at("09:00") },
      { id: "draft-2", anchor: at("09:05") },
    ],
    sessions: [{ id: "s-1", instant: at("09:30") }],
  });
  assert.deepEqual(plan.claims, [{ claimantId: "draft-1", sessionId: "s-1" }]);
  assert.deepEqual(plan.unclaimedSessionIds, []);
});

test("no claimants: every session is unclaimed, earliest first", () => {
  const plan = planDraftClaims({
    claimants: [],
    sessions: [
      { id: "b", instant: at("11:00") },
      { id: "a", instant: at("10:00") },
    ],
  });
  assert.deepEqual(plan.claims, []);
  assert.deepEqual(plan.unclaimedSessionIds, ["a", "b"]);
});
