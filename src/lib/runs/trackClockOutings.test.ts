/**
 * Run: `node --conditions=react-server --import tsx --test src/lib/runs/trackClockOutings.test.ts`
 *
 * The save's side of one run per time on track, on the track's clock: a stored MyRCM heat and the
 * practice loop's stored copy line up whatever zone the save came from, so the fold and "Add N
 * other runs" treat a driver home from the meeting like one in the pits.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  trackClockOutingFromImportedRow,
  trackClockSpanForExistingRun,
  type ImportedRowForOuting,
} from "@/lib/runs/outingsFromImportedSessions";
import { planSameOutingAbsorption } from "@/lib/runs/sameOutingAbsorption";

const laps = (n: number, t: number) => Array.from({ length: n }, () => t);

const MYRCM_ROW: ImportedRowForOuting = {
  id: "myrcm",
  sourceUrl: "myrcm-pdf://0123456789abcdef/report-96077-1.pdf",
  parserId: "myrcm-pdf",
  sessionCompletedAt: new Date("2026-08-23T10:36:37.000Z"),
  parsedPayload: {
    sessionCompletedAtIso: "2026-08-23T10:36:37.000Z",
    sessionDrivers: [
      { driverName: "Drew Gavin", laps: laps(27, 23.38) },
      { driverName: "Floro Ed", laps: laps(26, 23.93) },
    ],
  },
};

const speedhiveRow = (offset: number | null): ImportedRowForOuting => ({
  id: "speedhive",
  sourceUrl: "https://speedhive.mylaps.com/practice/4591/activities/12/sessions/3",
  parserId: "speedhive_practice_v1",
  sessionCompletedAt: new Date("2026-08-23T00:36:40.000Z"),
  parsedPayload: {
    sessionCompletedAtIso: "2026-08-23T00:36:40.000Z",
    ...(offset == null ? {} : { sessionUtcOffsetMinutes: offset }),
    sessionDrivers: [{ driverName: "10:36 AM", laps: laps(27, 23.38) }],
  },
});

test("a stored heat and the loop's stored copy line up on the track's clock, from any zone", () => {
  for (const zone of ["Australia/Sydney", "America/Los_Angeles", "Europe/London", null]) {
    const heat = trackClockOutingFromImportedRow(MYRCM_ROW, zone)!;
    const copy = trackClockOutingFromImportedRow(speedhiveRow(600), zone)!;
    assert.equal(heat.start.toISOString(), "2026-08-23T10:36:37.000Z", `zone ${zone}`);
    assert.equal(copy.start.toISOString(), "2026-08-23T10:36:40.000Z", `zone ${zone}`);
    assert.equal(heat.kind, "official");
    assert.equal(copy.kind, "practice");
  }
});

test("a loop copy stored before offsets were kept is read in the fallback zone", () => {
  assert.equal(
    trackClockOutingFromImportedRow(speedhiveRow(null), "Australia/Sydney")!.start.toISOString(),
    "2026-08-23T10:36:40.000Z"
  );
});

test("the fold finds the app-made run over the driver's race, wherever the save came from", () => {
  for (const zone of ["Australia/Sydney", "America/Los_Angeles"]) {
    const own = trackClockOutingFromImportedRow(MYRCM_ROW, zone)!;
    const appMade = trackClockOutingFromImportedRow(speedhiveRow(600), zone)!;
    assert.deepEqual(
      planSameOutingAbsorption([own], [{ id: "app-run", spans: [appMade], writtenOn: false }]),
      ["app-run"],
      `zone ${zone}`
    );
  }
});

test("an existing run reads on the track's clock: its session when it has one, else its own stamp", () => {
  const withSession = trackClockSpanForExistingRun(
    {
      sortAt: new Date("2026-08-24T08:00:00.000Z"),
      sessionCompletedAt: null,
      lapTimes: laps(27, 23.38),
      localTimeZone: "America/Los_Angeles",
      detectedImportedLapSession: speedhiveRow(600),
    },
    "America/Los_Angeles"
  )!;
  assert.equal(withSession.start.toISOString(), "2026-08-23T10:36:40.000Z");

  // Laps typed in at the track: the phone's clock then was the track's.
  const typedIn = trackClockSpanForExistingRun(
    {
      sortAt: new Date("2026-08-23T03:10:00.000Z"),
      sessionCompletedAt: null,
      lapTimes: laps(10, 24),
      localTimeZone: "Australia/Sydney",
      detectedImportedLapSession: null,
    },
    null
  )!;
  assert.equal(typedIn.start.toISOString(), "2026-08-23T13:10:00.000Z");
  assert.equal(typedIn.end.getTime() - typedIn.start.getTime(), 240_000);

  assert.equal(
    trackClockSpanForExistingRun(
      { sortAt: new Date(), sessionCompletedAt: null, lapTimes: [], localTimeZone: null, detectedImportedLapSession: null },
      null
    ),
    null
  );
});
