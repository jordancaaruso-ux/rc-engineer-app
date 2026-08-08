/**
 * Run: `npx tsx src/lib/events/seasonCadence.test.ts`
 *
 * The cadence read is the only sentence on the Events page the app writes rather than
 * measures — "You've raced Boronia 5 of the last 6 Saturdays." It shows in place of the
 * Next up card whenever nothing is booked, which is the founder's own state, so it gets
 * read at the track and has to survive being checked against a calendar.
 *
 * The bar these tests hold: it may only make a claim it can count, and when it cannot, it
 * must fall back to something merely true.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCadenceRead } from "@/lib/events/seasonCadence";
import type { SeasonEventRow } from "@/lib/events/seasonEventRow";

/** 8 Aug 2026 is a Saturday. */
const TODAY = "2026-08-08";

function event(partial: Partial<SeasonEventRow> & { startYmd: string }): SeasonEventRow {
  return {
    id: partial.startYmd,
    name: "Clubday",
    endYmd: partial.startYmd,
    dayCount: 1,
    trackId: "boronia",
    trackName: "Boronia",
    trackLocation: "Melbourne",
    status: "logged",
    runCount: 4,
    bestLapSeconds: 16.4,
    vsVenueSeconds: null,
    isVenueBest: false,
    ...partial,
  };
}

/** The n-th most recent Saturday before today (1 = 1 Aug, 2 = 25 Jul, …). */
function saturdaysAgo(n: number): string {
  const d = new Date(Date.UTC(2026, 7, 1) - (n - 1) * 7 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test("names the venue, the count and the weekday", () => {
  const events = [1, 2, 3, 5, 6].map((n) => event({ startYmd: saturdaysAgo(n) }));
  const read = buildCadenceRead(events, TODAY);
  assert.equal(read.headline, "You've raced Boronia 5 of the last 6 Saturdays.");
});

test("the suggested date is the next occurrence of that weekday", () => {
  const events = [1, 2, 3].map((n) => event({ startYmd: saturdaysAgo(n) }));
  const read = buildCadenceRead(events, TODAY);
  // The last Saturday that has been was 1 Aug, so the next one is 8 Aug — today.
  assert.equal(read.suggestedYmd, "2026-08-08");
  assert.equal(read.suggestedLabel, "Saturday 8 Aug");
});

test("a single visit is not a rhythm — it falls back to the last day out", () => {
  const read = buildCadenceRead([event({ startYmd: saturdaysAgo(1) })], TODAY);
  assert.equal(read.headline, "Your last day out was Boronia, 7 days ago.");
  assert.equal(read.suggestedYmd, null);
});

test("only the last six occurrences count, so an old burst cannot inflate the claim", () => {
  // Two Saturdays inside the window, four more well outside it.
  const events = [1, 2, 8, 9, 10, 11].map((n) => event({ startYmd: saturdaysAgo(n) }));
  const read = buildCadenceRead(events, TODAY);
  assert.equal(read.headline, "You've raced Boronia 2 of the last 6 Saturdays.");
});

test("the strongest pattern wins when two venues both have one", () => {
  const events = [
    ...[1, 2, 3, 4].map((n) => event({ startYmd: saturdaysAgo(n) })),
    // Sundays at a second track — a real pattern, but a weaker one.
    ...[1, 2].map((n) =>
      event({
        startYmd: new Date(Date.UTC(2026, 7, 2) - (n - 1) * 7 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        id: `tftr-${n}`,
        trackId: "tftr",
        trackName: "TFTR",
      })
    ),
  ];
  const read = buildCadenceRead(events, TODAY);
  assert.equal(read.headline, "You've raced Boronia 4 of the last 6 Saturdays.");
});

test("booked events are not evidence of what you have done", () => {
  const events = [1, 2].map((n) => event({ startYmd: saturdaysAgo(n) }));
  events.push(event({ startYmd: "2026-08-15", id: "future", status: "booked" }));
  const read = buildCadenceRead(events, TODAY);
  assert.equal(read.headline, "You've raced Boronia 2 of the last 6 Saturdays.");
  assert.equal(read.lastOut?.ymd, saturdaysAgo(1), "last out is the last LOGGED event");
});

test("racing that stopped months ago is history, not a cadence", () => {
  // Six Saturdays, all more than 120 days back.
  const events = [20, 21, 22, 23, 24, 25].map((n) => event({ startYmd: saturdaysAgo(n) }));
  const read = buildCadenceRead(events, TODAY);
  assert.ok(
    read.headline.startsWith("Your last day out was"),
    `expected a fallback, got: ${read.headline}`
  );
  assert.equal(read.suggestedYmd, null);
});

test("an empty account says so instead of inventing a rhythm", () => {
  const read = buildCadenceRead([], TODAY);
  assert.equal(read.headline, "No meetings logged yet.");
  assert.equal(read.lastOut, null);
});

test("events with no track cannot anchor a claim", () => {
  const events = [1, 2, 3].map((n) =>
    event({ startYmd: saturdaysAgo(n), trackId: null, trackName: null })
  );
  const read = buildCadenceRead(events, TODAY);
  assert.ok(read.headline.startsWith("Your last day out was"));
});

test("the day count in the fallback is real", () => {
  const read = buildCadenceRead([event({ startYmd: "2026-08-07" })], TODAY);
  assert.equal(read.headline, "Your last day out was Boronia, 1 day ago.");
});
