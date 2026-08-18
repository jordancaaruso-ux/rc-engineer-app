/**
 * Run: `npx tsx src/lib/events/eventAccess.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditSharedEventFields, mayJoinEvent } from "@/lib/events/eventAccessLogic";

const creator = { id: "user-a", email: "a@example.com" };
const other = { id: "user-b", email: "b@example.com" };
const admin = { id: "user-admin", email: "admin@example.com" };

test("canEditSharedEventFields allows event creator", () => {
  assert.equal(canEditSharedEventFields(creator, { userId: "user-a" }), true);
});

test("canEditSharedEventFields denies non-creator", () => {
  assert.equal(canEditSharedEventFields(other, { userId: "user-a" }), false);
});

test("canEditSharedEventFields denies non-admin when creator is null", () => {
  assert.equal(canEditSharedEventFields(other, { userId: null }), false);
});

test("canEditSharedEventFields allows admin for legacy null creator", () => {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
  try {
    assert.equal(canEditSharedEventFields(admin, { userId: null }), true);
  } finally {
    if (prev === undefined) delete process.env.AUTH_ADMIN_EMAILS;
    else process.env.AUTH_ADMIN_EMAILS = prev;
  }
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
