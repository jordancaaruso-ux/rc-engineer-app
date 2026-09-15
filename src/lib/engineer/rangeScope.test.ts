/**
 * Run: `npm run test:engineer-history`.
 *
 * The filter scope crosses three boundaries — URL, request body, database — and each one must
 * read the same thing. A scope the body cannot forge (an id with a quote in it, a date that
 * isn't one) is dropped, not passed through to Prisma.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeRangeDates,
  describeRangeScope,
  eventScope,
  parseRangeScope,
  rangeScopeFromSearchParams,
  rangeScopeToQuery,
  sameRangeScope,
  writeRangeScopeToSearchParams,
} from "@/lib/engineer/rangeScope";

test("an untrusted body becomes a clean scope, or null when it is not a scope at all", () => {
  assert.equal(parseRangeScope(null), null);
  assert.equal(parseRangeScope("range"), null);
  assert.deepEqual(parseRangeScope({}), { eventId: null, trackId: null, carId: null, from: null, to: null });
  assert.deepEqual(
    parseRangeScope({ eventId: "ev1", trackId: "clx1", carId: "c'; drop", from: "2026-06-01", to: "yesterday" }),
    { eventId: "ev1", trackId: "clx1", carId: null, from: "2026-06-01", to: null }
  );
});

test("a back-to-front date range is swapped, never rejected", () => {
  assert.deepEqual(parseRangeScope({ from: "2026-09-14", to: "2026-06-01" }), {
    eventId: null,
    trackId: null,
    carId: null,
    from: "2026-06-01",
    to: "2026-09-14",
  });
});

test("the URL round-trips, and only mode=filter reads as a filter", () => {
  const scope = { eventId: null, trackId: "t1", carId: null, from: "2026-06-01", to: null };
  const sp = new URLSearchParams();
  writeRangeScopeToSearchParams(sp, scope);
  assert.equal(sp.toString(), "mode=filter&track=t1&from=2026-06-01");
  assert.deepEqual(rangeScopeFromSearchParams(sp), scope);
  assert.equal(rangeScopeFromSearchParams(new URLSearchParams("track=t1&from=2026-06-01")), null);
  assert.equal(rangeScopeFromSearchParams(new URLSearchParams("mode=range&track=t1")), null, "the old word is gone");
  assert.equal(rangeScopeToQuery(scope), "trackId=t1&from=2026-06-01");
  assert.ok(sameRangeScope(scope, { ...scope }));
  assert.ok(!sameRangeScope(scope, { ...scope, to: "2026-09-01" }));

  const ev = new URLSearchParams();
  writeRangeScopeToSearchParams(ev, eventScope("ev1"));
  assert.equal(ev.toString(), "mode=filter&event=ev1");
  assert.equal(rangeScopeToQuery(eventScope("ev1")), "eventId=ev1");
});

test("dates read the way the Sessions filter prints them", () => {
  assert.equal(describeRangeDates({ from: null, to: null }), "all dates");
  assert.equal(describeRangeDates({ from: "2026-06-01", to: "2026-09-14" }, 2026), "1 Jun – 14 Sep");
  assert.equal(describeRangeDates({ from: "2025-06-01", to: "2026-09-14" }, 2026), "1 Jun 2025 – 14 Sep");
  assert.equal(describeRangeDates({ from: "2026-06-01", to: null }, 2026), "from 1 Jun");
  assert.equal(describeRangeDates({ from: null, to: "2026-06-01" }, 2026), "to 1 Jun");
  assert.equal(describeRangeDates({ from: "2026-06-01", to: "2026-06-01" }, 2026), "1 Jun");
});

test("the bar's label names the meeting or the track, the car, the dates and the count", () => {
  const names = {
    events: [{ id: "ev1", name: "SA State Titles 2026" }],
    tracks: [{ id: "t1", name: "Keilor" }],
    cars: [{ id: "c1", name: "A800RR" }],
    count: 43,
  };
  assert.equal(
    describeRangeScope({ eventId: null, trackId: "t1", carId: "c1", from: "2026-06-01", to: "2026-09-14" }, names, 2026),
    "Keilor · A800RR · 1 Jun – 14 Sep · 43 runs"
  );
  assert.equal(describeRangeScope(eventScope("ev1"), { ...names, count: 20 }), "SA State Titles 2026 · 20 runs");
  assert.equal(
    describeRangeScope({ eventId: null, trackId: null, carId: null, from: null, to: null }, { tracks: [], cars: [], count: 1 }),
    "All tracks · all dates · 1 run"
  );
  assert.equal(
    describeRangeScope({ eventId: null, trackId: "gone", carId: null, from: null, to: null }, { tracks: [], cars: [] }),
    "One track · all dates"
  );
});
