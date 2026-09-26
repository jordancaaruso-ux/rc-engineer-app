/**
 * Run: `npx tsx src/lib/events/eventAccess.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditSharedEventFields,
  eventDeleteBlock,
  isLiveRcMeeting,
  mayJoinEvent,
} from "@/lib/events/eventAccessLogic";

const creator = { id: "user-a", email: "a@example.com" };
const other = { id: "user-b", email: "b@example.com" };
const admin = { id: "user-admin", email: "admin@example.com" };

const LIVERC = "https://emcc.liverc.com/results/?p=view_event&id=cup";
const handMade = (userId: string | null) => ({ userId, resultsSourceUrl: null });
const liveRc = (userId: string | null) => ({ userId, resultsSourceUrl: LIVERC });

function asAdmin(fn: () => void) {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.AUTH_ADMIN_EMAILS;
    else process.env.AUTH_ADMIN_EMAILS = prev;
  }
}

test("canEditSharedEventFields allows event creator", () => {
  assert.equal(canEditSharedEventFields(creator, handMade("user-a")), true);
});

test("canEditSharedEventFields denies non-creator", () => {
  assert.equal(canEditSharedEventFields(other, handMade("user-a")), false);
});

test("canEditSharedEventFields denies non-admin when creator is null", () => {
  assert.equal(canEditSharedEventFields(other, handMade(null)), false);
});

test("canEditSharedEventFields allows admin for legacy null creator", () => {
  asAdmin(() => assert.equal(canEditSharedEventFields(admin, handMade(null)), true));
});

// W1-01 (test drive 2026-09-26): Chloe picked LiveRC's EMCC Cup first, was recorded as its
// maker, and renamed it for Ethan and every other stranger at it.

test("a LiveRC meeting has no racer maker: the driver who picked it first can't edit it", () => {
  assert.equal(canEditSharedEventFields(creator, liveRc("user-a")), false);
  assert.equal(canEditSharedEventFields(other, liveRc("user-a")), false);
});

test("an admin can still edit a LiveRC meeting", () => {
  asAdmin(() => assert.equal(canEditSharedEventFields(admin, liveRc("user-a")), true));
});

test("isLiveRcMeeting reads the results link, and a blank one is not a link", () => {
  assert.equal(isLiveRcMeeting({ resultsSourceUrl: LIVERC }), true);
  assert.equal(isLiveRcMeeting({ resultsSourceUrl: "  " }), false);
  assert.equal(isLiveRcMeeting({ resultsSourceUrl: null }), false);
  // A blank link leaves a hand-made meeting its maker's.
  assert.equal(canEditSharedEventFields(creator, { userId: "user-a", resultsSourceUrl: " " }), true);
});

const FACTS = {
  alreadyOn: false,
  creatorUserId: "user-a",
  resultsSourceUrl: null,
  creatorIsTeammate: false,
};

test("mayJoinEvent lets the creator on their own event", () => {
  assert.equal(mayJoinEvent("user-a", FACTS), true);
});

test("mayJoinEvent keeps a stranger off a planned event", () => {
  // The bug this rule exists for: a planned event at a shared track is one person's
  // intention, not an open meeting.
  assert.equal(mayJoinEvent("user-b", FACTS), false);
});

test("mayJoinEvent lets a teammate on a planned event", () => {
  assert.equal(mayJoinEvent("user-b", { ...FACTS, creatorIsTeammate: true }), true);
});

test("mayJoinEvent lets a stranger onto a real LiveRC meeting", () => {
  // A results URL is a public claim about a real race — two strangers entering it are there.
  assert.equal(
    mayJoinEvent("user-b", {
      ...FACTS,
      resultsSourceUrl: "https://liverc.com/results/?p=view_event&id=1",
    }),
    true
  );
});

test("mayJoinEvent ignores a blank results URL", () => {
  assert.equal(mayJoinEvent("user-b", { ...FACTS, resultsSourceUrl: "   " }), false);
});

test("mayJoinEvent leaves anyone already on the event alone", () => {
  assert.equal(mayJoinEvent("user-b", { ...FACTS, alreadyOn: true }), true);
});

test("mayJoinEvent denies a stranger when the creator row is gone", () => {
  assert.equal(mayJoinEvent("user-b", { ...FACTS, creatorUserId: null }), false);
});

// Delete your own meeting (founder ruling 2026-09-26: "if nobody else is on it").

const MINE = { creatorUserId: "user-a", resultsSourceUrl: null, othersOnIt: 0 };

test("eventDeleteBlock lets the maker delete a meeting nobody else is on", () => {
  assert.equal(eventDeleteBlock("user-a", MINE), null);
});

test("eventDeleteBlock stops the maker once another driver is on it", () => {
  assert.equal(eventDeleteBlock("user-a", { ...MINE, othersOnIt: 1 }), "others-on-it");
});

test("eventDeleteBlock stops anyone who didn't make it, admins included", () => {
  asAdmin(() => {
    assert.equal(eventDeleteBlock("user-b", MINE), "not-maker");
    assert.equal(eventDeleteBlock("user-admin", MINE), "not-maker");
  });
});

test("eventDeleteBlock leaves a legacy meeting with no maker alone", () => {
  assert.equal(eventDeleteBlock("user-a", { ...MINE, creatorUserId: null }), "not-maker");
});

test("eventDeleteBlock never offers to delete a LiveRC meeting, even to the driver who picked it", () => {
  assert.equal(eventDeleteBlock("user-a", { ...MINE, resultsSourceUrl: LIVERC }), "liverc-meeting");
});
