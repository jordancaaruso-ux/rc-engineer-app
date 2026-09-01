import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_DASHBOARD_DAYS,
  rankResumableDrafts,
  type DraftRunCandidate,
} from "@/lib/runs/resumableDraftLogic";

/**
 * A fixed zone, so the assertions mean the same thing on a Sydney laptop and a UTC CI box.
 * Australia/Sydney is UTC+10 in August — the offset that made the old code file race morning
 * under the previous day.
 */
const TZ = "Australia/Sydney";
/** 2026-08-25, 09:00 local (= 23:00 UTC on the 24th). Race-morning o'clock. */
const NOW = new Date("2026-08-24T23:00:00Z");

function draft(
  id: string,
  savedAtIso: string,
  event?: { name: string; startYmd: string; endYmd: string }
): DraftRunCandidate {
  return {
    id,
    savedAt: new Date(savedAtIso),
    eventId: event ? `ev-${id}` : null,
    eventName: event?.name ?? null,
    eventStartDate: event ? new Date(`${event.startYmd}T12:00:00Z`) : null,
    eventEndDate: event ? new Date(`${event.endYmd}T12:00:00Z`) : null,
  };
}

function rank(candidates: DraftRunCandidate[]) {
  return rankResumableDrafts({ candidates, referenceDate: NOW, timeZone: TZ });
}

test("the window is three calendar days: today, yesterday, the day before", () => {
  assert.equal(DRAFT_DASHBOARD_DAYS, 3);
  const ranked = rank([
    // 09:00 local today.
    draft("today", "2026-08-24T23:00:00Z"),
    // 23:30 local yesterday (the 24th) — a late-night save, still inside.
    draft("yesterday", "2026-08-24T13:30:00Z"),
    // 00:05 local on the 23rd — the very first minute of the oldest day that counts.
    draft("edge-in", "2026-08-22T14:05:00Z"),
    // 23:55 local on the 22nd — five minutes older, and out.
    draft("edge-out", "2026-08-22T13:55:00Z"),
  ]);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["today", "yesterday", "edge-in"]
  );
});

test("a draft from months of testing is not offered — the bug this rule exists for", () => {
  const ranked = rank([draft("stale", "2026-04-11T08:00:00Z")]);
  assert.deepEqual(ranked, [], "nothing for the dashboard to show");
});

test("a draft banked weeks ahead survives for the day its meeting runs", () => {
  const banked = draft("banked", "2026-08-10T08:00:00Z", {
    name: "Round 4",
    startYmd: "2026-08-25",
    endYmd: "2026-08-26",
  });
  const scratch = draft("scratch", "2026-08-24T13:00:00Z");
  const ranked = rank([scratch, banked]);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["banked", "scratch"],
    "the meeting that is on NOW outranks last night's scratch draft"
  );
  assert.equal(ranked[0]!.isForToday, true);
  assert.equal(ranked[1]!.isForToday, false);
});

test("saved this morning counts as for-today without any event", () => {
  const ranked = rank([draft("today", "2026-08-24T22:30:00Z")]);
  assert.equal(ranked[0]!.isForToday, true);
});

test("race morning at UTC+10 is not read as the day before", () => {
  /*
   * The bug this pins: at 09:00 Sydney the UTC instant is still 2026-08-24. Comparing the event's
   * UTC calendar day against a UTC reading of "now" makes today's meeting look like tomorrow's,
   * and the bar stays silent on the one morning it matters.
   */
  const ranked = rank([
    draft("meeting", "2026-08-20T08:00:00Z", {
      name: "Club round",
      startYmd: "2026-08-25",
      endYmd: "2026-08-25",
    }),
  ]);
  assert.equal(ranked[0]!.isForToday, true);
});

test("a finished meeting does not keep an old draft alive", () => {
  const stale = draft("stale", "2026-08-10T08:00:00Z", {
    name: "Round 3",
    startYmd: "2026-08-15",
    endYmd: "2026-08-16",
  });
  assert.deepEqual(rank([stale]), [], "the event is over, so only the three-day window applies");
});

test("a recent draft whose meeting has finished is still listed, but never leads", () => {
  const ranked = rank([
    draft("done-event", "2026-08-23T08:00:00Z", {
      name: "Round 3",
      startYmd: "2026-08-22",
      endYmd: "2026-08-23",
    }),
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.isForToday, false);
});

test("equal saves fall back to id so the order never flickers between loads", () => {
  const a = draft("aaa", "2026-08-24T22:00:00Z");
  const b = draft("bbb", "2026-08-24T22:00:00Z");
  assert.deepEqual(rank([b, a]).map((r) => r.id), ["aaa", "bbb"]);
});

test("a draft from a device whose clock runs ahead is not dropped", () => {
  const ranked = rank([draft("future", "2026-08-26T02:00:00Z")]);
  assert.equal(ranked.length, 1, "a negative age is inside the window, not outside it");
});
