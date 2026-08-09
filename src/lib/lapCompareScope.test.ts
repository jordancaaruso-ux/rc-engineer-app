import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lapCompareTrackKey,
  lapSeriesMatchesCompareScope,
  sameLocalCalendarDay,
} from "@/lib/lapCompareScope";

/** Local-midnight ISO so the same-day assertions don't straddle a UTC boundary. */
function localIso(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m - 1, d, h, 0, 0).toISOString();
}

const AUG_2 = localIso(2026, 8, 2, 22);
const APR_10 = localIso(2026, 4, 10, 12);

test("same_day keeps the run's own imported race field regardless of its date", () => {
  // The bug: a run logged in August carrying an April timing sheet showed
  // "No lap series match this scope and driver" — its whole field was filtered out.
  assert.equal(
    lapSeriesMatchesCompareScope({
      seriesId: "imported:set1",
      sortIso: APR_10,
      scope: "same_day",
      anchorInstantIso: AUG_2,
    }),
    true
  );
});

test("same_day keeps the imported field under every scope", () => {
  for (const scope of ["all", "same_day", "same_event"] as const) {
    assert.equal(
      lapSeriesMatchesCompareScope({
        seriesId: "imported:set1",
        sortIso: APR_10,
        scope,
        anchorInstantIso: AUG_2,
        anchorEventId: "evt-other",
      }),
      true,
      `imported set dropped under scope ${scope}`
    );
  }
});

test("same_day still filters library sessions and other runs by calendar day", () => {
  const off = { sortIso: APR_10, scope: "same_day" as const, anchorInstantIso: AUG_2 };
  const on = { sortIso: localIso(2026, 8, 2, 9), scope: "same_day" as const, anchorInstantIso: AUG_2 };
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "library:l1", ...off }), false);
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "library:l1", ...on }), true);
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "history:r1", ...off }), false);
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "history:r1", ...on }), true);
});

test("all keeps everything", () => {
  for (const id of ["run:primary", "imported:s1", "history:r1", "library:l1"]) {
    assert.equal(
      lapSeriesMatchesCompareScope({
        seriesId: id,
        sortIso: APR_10,
        scope: "all",
        anchorInstantIso: AUG_2,
      }),
      true,
      `${id} dropped under scope all`
    );
  }
});

test("same_event matches history runs on the anchor's event", () => {
  const base = {
    sortIso: APR_10,
    scope: "same_event" as const,
    anchorInstantIso: AUG_2,
    anchorEventId: "evt-1",
    eventIdForHistoryRun: (id: string) => (id === "r-in" ? "evt-1" : "evt-2"),
  };
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "history:r-in", ...base }), true);
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "history:r-out", ...base }), false);
  // An unknown run id must not match a null anchor event by accident.
  assert.equal(
    lapSeriesMatchesCompareScope({
      seriesId: "history:r-unknown",
      ...base,
      eventIdForHistoryRun: () => undefined,
    }),
    false
  );
});

test("same_event drops library sessions but keeps run series when the anchor has no event", () => {
  const base = {
    sortIso: APR_10,
    scope: "same_event" as const,
    anchorInstantIso: AUG_2,
    anchorEventId: null,
  };
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "library:l1", ...base }), false);
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "history:r1", ...base }), true);
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "run:primary", ...base }), true);
});

test("same_track keeps the venue's sessions whatever day they fell on", () => {
  const base = {
    scope: "same_track" as const,
    anchorInstantIso: AUG_2,
    anchorTrackKey: lapCompareTrackKey("MR33 Arena"),
    trackKeyForSeries: (id: string) =>
      id === "history:elsewhere" ? lapCompareTrackKey("Geelong") : lapCompareTrackKey("mr33 arena"),
  };
  // The run being viewed is always in scope.
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "run:primary", sortIso: APR_10, ...base }), true);
  // A session at the same venue months earlier stays — this is the point of the scope.
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "history:r1", sortIso: APR_10, ...base }), true);
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "library:l1", sortIso: APR_10, ...base }), true);
  // A different venue is out.
  assert.equal(
    lapSeriesMatchesCompareScope({ seriesId: "history:elsewhere", sortIso: AUG_2, ...base }),
    false
  );
  // The run's own imported race field is never scoped away.
  assert.equal(lapSeriesMatchesCompareScope({ seriesId: "imported:s1", sortIso: APR_10, ...base }), true);
});

test("same_track: the split test day that started all this stays visible", () => {
  // Two halves of one continuous session, either side of the reader's midnight.
  // Under same_day the afternoon half vanished; under same_track it cannot.
  const morning = localIso(2026, 8, 6, 9);
  const afterMidnightForReader = localIso(2026, 8, 7, 1);
  const base = {
    scope: "same_track" as const,
    anchorInstantIso: morning,
    anchorTrackKey: lapCompareTrackKey("MR33 Arena"),
    trackKeyForSeries: () => lapCompareTrackKey("MR33 Arena"),
  };
  assert.equal(
    lapSeriesMatchesCompareScope({ seriesId: "history:late", sortIso: afterMidnightForReader, ...base }),
    true
  );
  // Same pair under the old default — dropped, which is the reported bug.
  assert.equal(
    lapSeriesMatchesCompareScope({
      seriesId: "history:late",
      sortIso: afterMidnightForReader,
      scope: "same_day",
      anchorInstantIso: morning,
    }),
    false
  );
});

test("same_track drops a series whose track is unknown rather than guessing", () => {
  assert.equal(
    lapSeriesMatchesCompareScope({
      seriesId: "library:unlinked",
      sortIso: AUG_2,
      scope: "same_track",
      anchorInstantIso: AUG_2,
      anchorTrackKey: lapCompareTrackKey("MR33 Arena"),
      trackKeyForSeries: () => null,
    }),
    false
  );
  // And with no track on the anchor there is nothing to match against.
  assert.equal(
    lapSeriesMatchesCompareScope({
      seriesId: "history:r1",
      sortIso: AUG_2,
      scope: "same_track",
      anchorInstantIso: AUG_2,
      anchorTrackKey: null,
      trackKeyForSeries: () => lapCompareTrackKey("MR33 Arena"),
    }),
    false
  );
});

test("lapCompareTrackKey normalises case and spacing, and rejects empty", () => {
  assert.equal(lapCompareTrackKey("  MR33 Arena "), "mr33 arena");
  assert.equal(lapCompareTrackKey(""), null);
  assert.equal(lapCompareTrackKey(null), null);
  assert.equal(lapCompareTrackKey(undefined), null);
});

test("sameLocalCalendarDay rejects unparseable instants rather than matching them", () => {
  assert.equal(sameLocalCalendarDay("not-a-date", AUG_2), false);
  assert.equal(sameLocalCalendarDay(AUG_2, ""), false);
  assert.equal(sameLocalCalendarDay(AUG_2, AUG_2), true);
});
