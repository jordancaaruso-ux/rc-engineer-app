/**
 * Run: `npx tsx --test src/lib/lapImport/sameOutingBlocks.test.ts`
 *
 * The same race from two timing sites on one run: linked, never joined into the laps. The fixture
 * is LS Club Day's Heat 1 Qualy 1 (MyRCM PDF, 23.08.2026 10:36:37 at a Sydney track) and the
 * Speedhive practice loop's copy of the same heat, a real instant three seconds later with the
 * track's +10:00 beside it. Matched on the track's clock, so the phone's zone never decides it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { UrlImportBlock } from "@/components/runs/LapTimesIngestPanel";
import type { LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { primaryRowsAcrossBlocks } from "@/lib/lapImport/blockLapRows";
import {
  buildLapIngestFromEditRun,
  type EditRunImportedLapSet,
  type EditRunLinkedImportedSession,
} from "@/lib/lapImport/buildLapIngestFromEditRun";
import {
  attachUnderSameOutingRule,
  blockOutingSpan,
  linkedSourcesAfterRemoving,
  reopenUnderSameOutingRule,
  sameOutingAttach,
} from "@/lib/lapImport/sameOutingBlocks";

const TZ = "Australia/Sydney";
const MYRCM_URL = "myrcm-pdf://0123456789abcdef/report-96077-1.pdf";
const SPEEDHIVE_URL = "https://speedhive.mylaps.com/practice/4591/activities/12";

const laps = (n: number, t: number) => Array.from({ length: n }, () => t);

function driver(id: string, name: string, times: number[]): LapUrlSessionDriver {
  return { id, driverId: id, driverName: name, normalizedName: name.toLowerCase(), laps: times, lapCount: times.length };
}

function block(input: {
  id: string;
  sessionId?: string;
  url: string;
  parserId: string;
  iso: string | null;
  /** Speedhive practice: the track's offset from UTC, as the import keeps it. */
  utcOffsetMinutes?: number | null;
  drivers: LapUrlSessionDriver[];
  selected?: string;
}): UrlImportBlock {
  const selected = input.selected ?? input.drivers[0]?.driverId;
  return {
    blockId: input.id,
    importedSessionId: input.sessionId ?? `sess-${input.id}`,
    sourceUrl: input.url,
    parserId: input.parserId,
    recordedAt: "2026-08-24T09:00:00.000Z",
    sessionCompletedAtDbIso: input.iso,
    sessionCompletedAtIso: input.iso,
    sessionUtcOffsetMinutes: input.utcOffsetMinutes ?? null,
    sessionDrivers: input.drivers,
    selectedDriverIds: selected ? [selected] : [],
    driverLapRowsByDriverId: Object.fromEntries(
      input.drivers.map((d) => [
        d.driverId,
        d.laps.map((t, i) => ({ lapNumber: i + 1, lapTimeSeconds: t, isIncluded: true })),
      ])
    ),
    urlLapRows: null,
  };
}

/** The heat on MyRCM: wall clock stored as-if-UTC, the whole field, 27 laps for the winner. */
const MYRCM_HEAT = block({
  id: "myrcm",
  url: MYRCM_URL,
  parserId: "myrcm-pdf",
  iso: "2026-08-23T10:36:37.000Z",
  drivers: [
    driver("myrcm-pdf-p1", "Drew Gavin", laps(27, 23.38)),
    driver("myrcm-pdf-p2", "Floro Ed", laps(26, 23.93)),
    driver("myrcm-pdf-p3", "Mealey Keith", laps(24, 25.39)),
  ],
});

/** The same heat on Speedhive's practice loop: a real instant (10:36:40 AEST), just the chip. */
const SPEEDHIVE_COPY = block({
  id: "speedhive",
  url: SPEEDHIVE_URL,
  parserId: "speedhive_practice_v1",
  iso: "2026-08-23T00:36:40.000Z",
  utcOffsetMinutes: 600,
  drivers: [driver("chip-1", "Gavin Drew", laps(27, 23.38))],
});

/** Where the phone might be when the driver logs the meeting: at the track, or flown home. */
const PHONE_ZONES = [TZ, "America/Los_Angeles", "Europe/London", "Australia/Perth", null];

test("both sites' copies of the heat read the same track time, wherever the phone is", () => {
  for (const phone of PHONE_ZONES) {
    const myrcm = blockOutingSpan(MYRCM_HEAT, phone)!;
    const speedhive = blockOutingSpan(SPEEDHIVE_COPY, phone)!;
    assert.equal(myrcm.start.toISOString(), "2026-08-23T10:36:37.000Z", `phone in ${phone}`);
    assert.equal(speedhive.start.toISOString(), "2026-08-23T10:36:40.000Z", `phone in ${phone}`);
    assert.ok(Math.abs(myrcm.end.getTime() - speedhive.end.getTime()) < 5000);
  }
});

test("a driver home from the meeting still gets the copy linked, not the laps doubled", () => {
  for (const phone of PHONE_ZONES) {
    assert.deepEqual(
      sameOutingAttach([MYRCM_HEAT], SPEEDHIVE_COPY, phone),
      { kind: "linked", leadBlockId: "myrcm" },
      `phone in ${phone}`
    );
    const out = attachUnderSameOutingRule({
      blocks: [SPEEDHIVE_COPY],
      linkedSources: [],
      incoming: MYRCM_HEAT,
      fallbackTimeZone: phone,
      incomingLeads: true,
    });
    assert.deepEqual(out.outcome, { kind: "replaces", replacedBlockIds: ["speedhive"] }, `phone in ${phone}`);
    assert.equal(primaryRowsAcrossBlocks(out.blocks).length, 27);
  }
});

test("Speedhive's race result is the track's clock too, stamped at the last crossing", () => {
  const raceCopy = block({
    id: "speedhive-race",
    url: "https://speedhive.mylaps.com/events/3671358/sessions/77",
    parserId: "speedhive_api_v1",
    // The last crossing, 27 laps × 23.38 after the start, read off the track's clock.
    iso: new Date(Date.parse("2026-08-23T10:36:38.000Z") + 27 * 23.38 * 1000).toISOString(),
    drivers: [driver("sh-p1", "Gavin Drew", laps(27, 23.38))],
  });
  for (const phone of PHONE_ZONES) {
    assert.deepEqual(sameOutingAttach([MYRCM_HEAT], raceCopy, phone), { kind: "linked", leadBlockId: "myrcm" });
  }
});

test("a practice import saved before the offset was kept falls back to the phone's zone", () => {
  const old = { ...SPEEDHIVE_COPY, sessionUtcOffsetMinutes: null };
  assert.equal(sameOutingAttach([MYRCM_HEAT], old, TZ).kind, "linked");
  assert.equal(sameOutingAttach([MYRCM_HEAT], old, "America/Los_Angeles").kind, "separate");
});

test("Speedhive's copy tapped after the MyRCM result is linked, and the laps are not doubled", () => {
  const out = attachUnderSameOutingRule({
    blocks: [MYRCM_HEAT],
    linkedSources: [],
    incoming: SPEEDHIVE_COPY,
    fallbackTimeZone: TZ,
  });
  assert.deepEqual(out.outcome, { kind: "linked", leadBlockId: "myrcm" });
  assert.deepEqual(out.blocks.map((b) => b.blockId), ["myrcm"]);
  assert.deepEqual(out.linkedSources, [
    { importedSessionId: "sess-speedhive", sourceUrl: SPEEDHIVE_URL, parserId: "speedhive_practice_v1", leadBlockId: "myrcm" },
  ]);
  assert.equal(primaryRowsAcrossBlocks(out.blocks).length, 27);
});

test("the MyRCM PDF uploaded onto a run holding Speedhive's copy takes the laps; the copy rides along", () => {
  for (const incomingLeads of [true, false]) {
    const out = attachUnderSameOutingRule({
      blocks: [SPEEDHIVE_COPY],
      linkedSources: [],
      incoming: MYRCM_HEAT,
      fallbackTimeZone: TZ,
      incomingLeads,
    });
    assert.deepEqual(out.outcome, { kind: "replaces", replacedBlockIds: ["speedhive"] }, `incomingLeads=${incomingLeads}`);
    assert.deepEqual(out.blocks.map((b) => b.blockId), ["myrcm"]);
    assert.deepEqual(out.linkedSources.map((s) => [s.importedSessionId, s.leadBlockId]), [["sess-speedhive", "myrcm"]]);
    assert.equal(primaryRowsAcrossBlocks(out.blocks).length, 27);
  }
});

test("a file the driver brought on purpose takes the laps even from an equal record", () => {
  const liverc = block({
    id: "liverc",
    url: "https://club.liverc.com/results/?p=view_race_result&id=77",
    parserId: "liverc_race_result_v1",
    iso: "2026-08-23T10:36:00.000Z",
    drivers: [...MYRCM_HEAT.sessionDrivers.map((d) => ({ ...d, driverId: `l-${d.driverId}`, id: `l-${d.id}` }))],
  });
  assert.equal(sameOutingAttach([liverc], MYRCM_HEAT, TZ).kind, "linked", "a tie keeps the one attached first");
  assert.equal(sameOutingAttach([liverc], MYRCM_HEAT, TZ, { incomingLeads: true }).kind, "replaces");
});

test("the halves of a run split by a break still join, even when a minutes-only site makes them touch", () => {
  // LiveRC practice prints 10:00 and 10:04; each half's laps run about five minutes.
  const first = block({
    id: "half-1",
    url: "https://club.liverc.com/practice/?p=view_session&id=1",
    parserId: "liverc_practice_session_v1",
    iso: "2026-09-12T10:00:00.000Z",
    drivers: [driver("d", "Split Tester", laps(20, 15))],
  });
  const second = block({
    id: "half-2",
    url: "https://club.liverc.com/practice/?p=view_session&id=2",
    parserId: "liverc_practice_session_v1",
    iso: "2026-09-12T10:04:00.000Z",
    drivers: [driver("d", "Split Tester", laps(22, 15))],
  });
  const out = attachUnderSameOutingRule({ blocks: [first], linkedSources: [], incoming: second, fallbackTimeZone: TZ });
  assert.deepEqual(out.outcome, { kind: "separate" });
  assert.equal(primaryRowsAcrossBlocks(out.blocks).length, 42);
});

test("replacing hands the replaced import's own copies to what replaced it", () => {
  const out = attachUnderSameOutingRule({
    blocks: [SPEEDHIVE_COPY],
    linkedSources: [
      { importedSessionId: "sess-other-loop", sourceUrl: "https://x/loop", parserId: "speedhive_practice_v1", leadBlockId: "speedhive" },
    ],
    incoming: MYRCM_HEAT,
    fallbackTimeZone: TZ,
  });
  assert.deepEqual(
    out.linkedSources.map((s) => [s.importedSessionId, s.leadBlockId]),
    [
      ["sess-other-loop", "myrcm"],
      ["sess-speedhive", "myrcm"],
    ]
  );
});

test("a copy comes off with its import, and a session taken on as laps stops being a copy", () => {
  const linked = [
    { importedSessionId: "sess-speedhive", sourceUrl: SPEEDHIVE_URL, parserId: "speedhive_practice_v1", leadBlockId: "myrcm" },
    { importedSessionId: "sess-z", sourceUrl: "https://x/z", parserId: "liverc_race_result_v1", leadBlockId: "other" },
  ];
  assert.deepEqual(
    linkedSourcesAfterRemoving(linked, new Set(["myrcm"])).map((s) => s.importedSessionId),
    ["sess-z"]
  );
  const retaken = attachUnderSameOutingRule({ blocks: [], linkedSources: linked, incoming: SPEEDHIVE_COPY, fallbackTimeZone: TZ });
  assert.deepEqual(retaken.linkedSources.map((s) => s.importedSessionId), ["sess-z"]);
  assert.deepEqual(retaken.blocks.map((b) => b.blockId), ["speedhive"]);
});

// ---- Reopening a saved run -------------------------------------------------------------------

function linkedSession(id: string, b: UrlImportBlock): EditRunLinkedImportedSession {
  return {
    id,
    sourceUrl: b.sourceUrl,
    parserId: b.parserId,
    createdAt: "2026-08-24T09:00:00.000Z",
    sessionCompletedAt: b.sessionCompletedAtDbIso ?? null,
    parsedPayload: {
      sessionCompletedAtIso: b.sessionCompletedAtIso,
      sessionUtcOffsetMinutes: b.sessionUtcOffsetMinutes ?? null,
      sessionDrivers: b.sessionDrivers.map((d) => ({ driverName: d.driverName, laps: d.laps })),
    },
  };
}

function setsFor(b: UrlImportBlock, primaryName: string): EditRunImportedLapSet[] {
  return b.sessionDrivers.map((d) => ({
    driverName: d.driverName,
    displayName: null,
    isPrimaryUser: d.driverName === primaryName,
    sourceUrl: b.sourceUrl,
    sessionCompletedAt: b.sessionCompletedAtIso,
    laps: d.laps.map((t, i) => ({ lapNumber: i + 1, lapTimeSeconds: t, isIncluded: true })),
  }));
}

test("a run whose laps came from MyRCM reopens with Speedhive's copy linked, not joined", () => {
  // Reopened at the track, or on the other side of the world: the copy's offset comes back from
  // its stored parse, so the phone's zone is never asked.
  for (const phone of PHONE_ZONES) {
    const ingest = buildLapIngestFromEditRun({
      lapTimes: laps(27, 23.38),
      lapSession: null,
      importedLapSets: setsFor(MYRCM_HEAT, "Drew Gavin"),
      linkedImportedSessions: [linkedSession("s-myrcm", MYRCM_HEAT), linkedSession("s-speedhive", SPEEDHIVE_COPY)],
      fallbackTimeZone: phone,
    });
    assert.deepEqual(ingest.urlImportBlocks.map((b) => b.importedSessionId), ["s-myrcm"], `phone in ${phone}`);
    assert.deepEqual(
      ingest.linkedSources?.map((s) => [s.importedSessionId, s.leadBlockId]),
      [["s-speedhive", "restored-s-myrcm"]]
    );
    assert.equal(primaryRowsAcrossBlocks(ingest.urlImportBlocks).length, 27);
  }
});

test("a run saved with the race twice reopens with it once, keeping the official record", () => {
  const ingest = buildLapIngestFromEditRun({
    lapTimes: laps(54, 23.38),
    lapSession: null,
    importedLapSets: [...setsFor(MYRCM_HEAT, "Drew Gavin"), ...setsFor(SPEEDHIVE_COPY, "Gavin Drew")],
    linkedImportedSessions: [linkedSession("s-speedhive", SPEEDHIVE_COPY), linkedSession("s-myrcm", MYRCM_HEAT)],
    fallbackTimeZone: TZ,
  });
  assert.deepEqual(ingest.urlImportBlocks.map((b) => b.importedSessionId), ["s-myrcm"]);
  assert.deepEqual(ingest.linkedSources?.map((s) => s.importedSessionId), ["s-speedhive"]);
});

test("the halves of a split run both reopen as laps", () => {
  const half = (id: string, iso: string, n: number) =>
    block({
      id,
      url: `https://club.liverc.com/practice/?p=view_session&id=${id}`,
      parserId: "liverc_practice_session_v1",
      iso,
      drivers: [driver("d", "Split Tester", laps(n, 15))],
    });
  const a = half("1", "2026-09-12T10:00:00.000Z", 20);
  const b = half("2", "2026-09-12T10:04:00.000Z", 22);
  const ingest = buildLapIngestFromEditRun({
    lapTimes: laps(42, 15),
    lapSession: null,
    importedLapSets: [...setsFor(a, "Split Tester"), ...setsFor(b, "Split Tester")],
    linkedImportedSessions: [linkedSession("s-1", a), linkedSession("s-2", b)],
    fallbackTimeZone: TZ,
  });
  assert.equal(ingest.urlImportBlocks.length, 2);
  assert.deepEqual(ingest.linkedSources, []);
  assert.equal(primaryRowsAcrossBlocks(ingest.urlImportBlocks).length, 42);
});

test("with no saved set carrying an address, everything reopens as it always did", () => {
  const blocks = [MYRCM_HEAT, SPEEDHIVE_COPY];
  const out = reopenUnderSameOutingRule({ blocks, lapSourceUrls: new Set(), fallbackTimeZone: TZ });
  assert.deepEqual(out.blocks.map((b) => b.blockId), ["myrcm", "speedhive"]);
  assert.deepEqual(out.linkedSources, []);
});

test("two races known only by their meeting's date are not the same race", () => {
  // A LiveRC race page prints only the meeting's date; stored at its midnight, the day's races all
  // covered the same "window", and the second race pasted onto a run was linked as a copy of the
  // first instead of being added (test drive, 2026-09-26).
  const a1 = block({
    id: "a1-main",
    url: "https://westcoast.liverc.com/results/?p=view_race_result&id=1001",
    parserId: "liverc_race_result_v1",
    iso: "2026-09-13T00:00:00.000Z",
    drivers: [driver("d1", "Mark Mayhew", laps(17, 18.2)), driver("d2", "Other Driver", laps(17, 18.5))],
  });
  const a3 = block({
    id: "a3-main",
    url: "https://westcoast.liverc.com/results/?p=view_race_result&id=1002",
    parserId: "liverc_race_result_v1",
    iso: "2026-09-13T00:00:00.000Z",
    drivers: [driver("d1", "Mark Mayhew", laps(16, 18.4)), driver("d3", "Third Driver", laps(16, 18.9))],
  });

  assert.equal(blockOutingSpan(a1, TZ), null, "a date is not a window on track");
  assert.deepEqual(sameOutingAttach([a1], a3, TZ), { kind: "separate" });
});
