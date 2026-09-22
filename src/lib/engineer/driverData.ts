import "server-only";

import { prisma } from "@/lib/prisma";
import { isSplitTireRun } from "@/lib/tires/runTireEnds";
import { normalizeTireFitment } from "@/lib/tires/tireFitment";
import { normalizeSetupData } from "@/lib/runSetup";
import {
  diffTuning,
  fmtSetupValue as fmtValue,
  leversNotOnSheet,
  readableSetupKey as readableKey,
  spurOverPinion,
  tuningValues,
} from "@/lib/engineer/setupDiff";
import { loadNets } from "@/lib/engineer/nets";
import { disciplineForCar } from "@/lib/cars/chassisPlatform";
import { disciplineLabel, parseDiscipline } from "@/lib/cars/carClasses";
import { findComparableRunsForEngineer } from "@/lib/engineer/findComparableRuns";
import {
  getAverageTopN,
  getBestLap,
  getDisplayFiveMinuteStint,
  primaryLapRowsFromRun,
  readFiveMinStartLap,
} from "@/lib/lapAnalysis";
import { formatFiveMinuteStint } from "@/lib/runLaps";
import { runLocalDayKey } from "@/lib/runs/buildRunHistoryGroups";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import type { EngineerPayloadBlock } from "@/lib/engineer/payload";
import type { FieldPace } from "@/lib/engineer/fieldPace";
import { FIELD_RUN_SELECT, loadFieldPaceForRuns } from "@/lib/engineer/fieldPaceLoad";
import { matchDriverName } from "@/lib/engineer/nameMatch";
import { driverKey, driversOnSheets, renderRivalSection, renderRivalsSummary, type RivalRun } from "@/lib/engineer/rivals";
import { renderLapsBlock } from "@/lib/engineer/lapsBlock";
import { loadLapsSessions } from "@/lib/engineer/lapsLoad";

/**
 * Driver-data blocks: the driver's own latest session, its setup, the rest of that day, and
 * the nearest earlier runs, fed to the Engineer as per-turn payload blocks.
 *
 * Lineage: these are v0's Engineer-lab fact blocks (engineerChat/lab/factBlocks.ts,
 * admin-gated, measured per-rung), promoted to always-on for every user by founder call
 * 2026-08-25 — ship first, iterate through the harness after (ENGINEER_NORTH_STAR
 * changelog). The lab's rule carries over unchanged: FACTS, NOT INSTRUCTIONS. Every block
 * is a plain statement of something true about this car and this session; none of them
 * tell the model how to think or what to conclude — that was the old pipeline's mistake
 * and it lost a blind 5-0.
 *
 * Which run: an explicit runId from the client wins (old-era clients still POST one);
 * otherwise the driver's latest run by `sortAt` — the stable ordering axis, stamped once
 * at create so re-imports never reshuffle a day. A driver with no runs gets [] and the
 * request is byte-identical to the data-less one, so a brand-new account asks the same
 * Engineer it always did.
 *
 * These blocks are per-turn material: cacheStable false, after every stable block, per
 * the payload contract in payload.ts.
 */

const MAX_SETUP_ROWS = 120;
/** A run where twenty things moved is noise, not evidence — say how many instead. */
const MAX_CHANGES_LISTED = 8;
/** Wide enough to hold a whole day either side of the anchor in any time zone. */
const DAY_WINDOW_MS = 40 * 3600_000;

function fmtSecs(v: number | null | undefined): string | null {
  return v == null || !Number.isFinite(v) ? null : v.toFixed(2);
}

/**
 * One clock for every block (2026-09-02). Before this, the day block read
 * `sessionCompletedAt` in the anchor's zone and the comparable block read
 * `resolveRunDisplayInstant` in UTC, so the same run printed 02:28 in one block and 16:28
 * in the next — and rows stamped by the old wall-clock-as-UTC bug shifted a further ten
 * hours. Every date and clock now comes from the instant the app itself displays, in the
 * zone the run was logged in (falling back to the driver's profile zone, as the sessions
 * list does).
 */
type RunInstantInput = Parameters<typeof resolveRunDisplayInstant>[0];

/** Calendar date in the logging zone; UTC when no zone is known at all. */
function fmtLocalDate(run: RunInstantInput, zone: string | null): string {
  const instant = resolveRunDisplayInstant(run);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: zone ?? "UTC",
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/**
 * Time of day in the zone the run was logged in. A run's clock belongs to the driver who
 * was there, not to whoever is reading. No zone → no clock: a wrong clock is worse than
 * none, and the lines are already in time order.
 */
function fmtLocalTime(run: RunInstantInput, zone: string | null): string | null {
  if (!zone) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: zone,
    }).format(resolveRunDisplayInstant(run));
  } catch {
    return null;
  }
}

type PaceInput = { lapTimes: unknown; lapSession: unknown };

/**
 * The three pace figures the app itself shows, from the same helpers the run card uses —
 * so the Engineer can never quote a number the driver cannot find on screen. The stint
 * honours a window the driver moved by hand; the other two are exclusion-aware.
 */
function runPace(run: PaceInput) {
  const rows = primaryLapRowsFromRun(run);
  const stint = getDisplayFiveMinuteStint(rows, readFiveMinStartLap(run.lapSession));
  return {
    lapCount: rows.length,
    best: getBestLap(rows),
    top5: getAverageTopN(rows, 5),
    stint: stint ? formatFiveMinuteStint(stint, 1) : null,
  };
}

async function loadRun(userId: string, runId: string | null) {
  return prisma.run.findFirst({
    where: runId ? { id: runId, userId } : { userId },
    orderBy: runId ? undefined : { sortAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      sortAt: true,
      localTimeZone: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
      unconfirmedAt: true,
      carId: true,
      raceClass: true,
      carRating: true,
      tireRunNumber: true,
      conditionsAirTempC: true,
      conditionsTrackTempC: true,
      conditionsHumidityPct: true,
      gripLevel: true,
      trackLayoutNameSnapshot: true,
      trackDirection: true,
      setupSnapshot: { select: { data: true } },
      car: {
        select: {
          id: true,
          name: true,
          chassis: true,
          setupSheetModelId: true,
          // What the car races (disciplineForCar) and which boxes its chassis's sheet has.
          carClass: true,
          setupSheetTemplate: true,
          setupSheetModel: { select: { slug: true, discipline: true, schemaJson: true } },
        },
      },
      track: { select: { name: true, gripTags: true, layoutTags: true } },
      trackLayout: { select: { name: true } },
      tireType: { select: { displayName: true, modelCode: true } },
      // The front end of a front/rear car (off-road) and what each end is glued to.
      frontTireRunNumber: true,
      frontTireAgeKnown: true,
      frontTireType: { select: { displayName: true, modelCode: true } },
      tireFitment: true,
      additiveType: { select: { displayName: true } },
      lapTimes: true,
      lapSession: true,
      ...FIELD_RUN_SELECT,
    },
  });
}

type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

function fmtDelta(v: number): string {
  const s = Math.abs(v).toFixed(2);
  return v > 0 ? `+${s}` : v < 0 ? `-${s}` : "0.00";
}

/**
 * The tyres, as facts. A single-tyre run — every on-road run — writes the two lines it always
 * has, byte for byte, so nothing the Engineer was calibrated on moves.
 *
 * A front/rear run (off-road, 2026-09-19; decided by the run's own data, `isSplitTireRun`) names
 * each end with its own run count, because the two ends are separate sets that age apart, and
 * says what each is mounted on. The driver's "modifications" note is quoted as they wrote it:
 * it is free text by design (founder ruling — no vent-hole number fields), so there is nothing
 * to normalise and any paraphrase here would be this file's invention, not a fact.
 */
function pushTyreFacts(
  run: LoadedRun,
  push: (label: string, value: string | number | null | undefined) => void
): void {
  const rearName = run.tireType?.displayName ?? run.tireType?.modelCode;
  if (!isSplitTireRun(run)) {
    push("tyre", rearName);
    push("tyre run number", run.tireRunNumber);
    return;
  }
  const fitment = normalizeTireFitment(run.tireFitment);
  const ends = [
    {
      end: "front",
      name: run.frontTireType?.displayName ?? run.frontTireType?.modelCode,
      runNumber: run.frontTireType ? run.frontTireRunNumber : null,
      ageKnown: run.frontTireAgeKnown,
      fit: fitment?.front,
    },
    { end: "rear", name: rearName, runNumber: run.tireType ? run.tireRunNumber : null, ageKnown: true, fit: fitment?.rear },
  ];
  for (const e of ends) {
    push(`${e.end} tyre`, e.name);
    push(
      `${e.end} tyre run number`,
      e.runNumber != null && e.ageKnown === false
        ? `${e.runNumber} (counted from when the driver got the set; its age before that is unknown)`
        : e.runNumber
    );
    push(`${e.end} insert`, e.fit?.insert);
    push(`${e.end} wheel`, e.fit?.wheel);
    push(
      `${e.end} modifications (the driver's own note)`,
      e.fit?.mods ? `"${e.fit.mods}"` : null
    );
  }
}

function buildSessionFactsBlock(
  run: LoadedRun,
  latestFallback: boolean,
  zone: string | null,
  field: FieldPace | null
): string | null {
  const facts: string[] = [];
  const push = (label: string, value: string | number | null | undefined) => {
    if (value == null || value === "") return;
    facts.push(`${label}: ${value}`);
  };

  push("car", run.car?.name ?? run.car?.chassis);
  // What the car IS, as the chassis or the driver declared it. Everything the Engineer was given
  // about what a knob does was written for one class of car; a driver on anything else is owed
  // that fact in place of a confident touring-car step (founder's open call, 2026-09-19: "the
  // honest line for non-touring cars"). A fact on the wire, not a prompt rule.
  const discipline = disciplineForCar(run.car);
  push("what this car races", disciplineLabel(discipline));
  if (discipline && parseDiscipline(discipline)?.classId !== "touring") {
    facts.push(
      "The setup effect priors in this request, their step sizes and their usual values were written for 1/10 touring cars. Nothing in this request was written for this car's class."
    );
  }
  push("class", run.raceClass);
  push("track", run.track?.name);
  push("layout", run.trackLayout?.name ?? run.trackLayoutNameSnapshot);
  push("direction", run.trackDirection);
  push(
    "grip",
    run.gripLevel ?? (run.track?.gripTags?.length ? run.track.gripTags.join(", ") : null)
  );
  push("layout style", run.track?.layoutTags?.length ? run.track.layoutTags.join(", ") : null);
  pushTyreFacts(run, push);
  push("additive", run.additiveType?.displayName);
  push("air temp °C", run.conditionsAirTempC);
  push("track temp °C", run.conditionsTrackTempC);
  push("humidity %", run.conditionsHumidityPct);

  const pace = runPace(run);
  push("laps recorded", pace.lapCount || null);
  push("best lap (s)", fmtSecs(pace.best));
  push("average of the best 5 laps (s)", fmtSecs(pace.top5));
  push("best five minutes (laps/time)", pace.stint);
  // The field from the timing sheet (fieldPace.ts): the one comparison that cancels the
  // track's own movement, because everyone drove the same surface at the same time.
  if (field && field.gapBestToP1 != null) {
    push("place in the session by best lap", `P${field.rank} of ${field.n} timed drivers`);
    push("best lap vs the fastest driver's best (s, positive = slower; 0.00 = you were fastest)", fmtDelta(field.gapBestToP1));
    if (field.gapTop5ToP1 != null) push("average of best 5 vs the best top-5 in the field (s)", fmtDelta(field.gapTop5ToP1));
    if (field.gapBestToMedian != null) push("best lap vs the field's median best (s, negative = faster than the middle of the field)", fmtDelta(field.gapBestToMedian));
  }
  push("driver's rating of the car (1-10)", run.carRating);
  push("session date", fmtLocalDate(run, zone));
  if (run.unconfirmedAt != null) {
    // With nothing on the sheet there was no setup to copy — saying one was copied made the
    // Engineer tell a driver with an empty sheet that his sheet "is not yet verified" (2026-09-19).
    facts.push(
      Object.keys(tuningValues(run.setupSnapshot?.data)).length > 0
        ? "unconfirmed: the app filed this run from the timing sheet. The laps are real; the setup, tyres and additive were copied from the previous logged run and the driver has not confirmed them."
        : "unconfirmed: the app filed this run from the timing sheet. The laps are real; the driver has not confirmed anything else about it."
    );
  }

  if (facts.length === 0) return null;
  const heading = latestFallback
    ? "THE DRIVER'S MOST RECENT LOGGED SESSION. Unless they say otherwise, assume questions about \"the car\" mean this one."
    : "THE SESSION BEING DISCUSSED.";
  return [heading, "", ...facts].join("\n");
}

/** Box keys on the chassis's own sheet — every box, filled or not. [] when the chassis has none. */
function chassisSheetKeys(run: LoadedRun): string[] {
  const schema = run.car?.setupSheetModel?.schemaJson as { fields?: Array<{ key?: unknown }> } | null | undefined;
  if (!schema || !Array.isArray(schema.fields)) return [];
  return schema.fields.map((f) => (typeof f?.key === "string" ? f.key : "")).filter(Boolean);
}

/**
 * The sheet, or — since 2026-09-21 — a plain statement that there is no sheet to read and why.
 *
 * Founder, 2026-09-21: "we need to have a strong distinction between when the engineer can read a
 * car and when it can't." Before this the block was simply absent, so the Engineer was never told
 * it was blind, could not tell a driver who had filled nothing in from one who had filled in 61
 * boxes the app could not name, and told a driver with an empty sheet that his sheet "was copied
 * forward and is not yet verified". Both cases are FACTS about the sheet; what to do about being
 * blind stays the prompt's ("say you can't see it, then answer what the physics alone can").
 */
/** Boxes with something in them, readable or not — what the driver has typed onto a sheet. */
function filledBoxCount(data: unknown): number {
  return Object.values(normalizeSetupData(data)).filter((raw) => fmtValue(raw) != null).length;
}

function buildSetupSheetBlock(
  run: LoadedRun,
  levers: ReadonlyArray<{ parameter: string; label: string }>,
  /** The same car's other runs that day: a run the app filed from the timing sheet can carry an empty sheet on a day the driver filled one in. */
  sameCarDay: ReadonlyArray<{ setupSnapshot: { data: unknown } | null }>
): string {
  const data = normalizeSetupData(run.setupSnapshot?.data);
  const car = run.car?.name ?? run.car?.chassis ?? "this car";
  const values = tuningValues(data);
  const rows = Object.entries(values)
    .slice(0, MAX_SETUP_ROWS)
    .map(([key, value]) => `${readableKey(key)}: ${value}`);

  if (rows.length === 0) {
    const filled = Math.max(filledBoxCount(data), ...sameCarDay.map((r) => filledBoxCount(r.setupSnapshot?.data)));
    return [
      `SETUP ON THE CAR (${car}): NOT VISIBLE.`,
      filled > 0
        ? `The driver filled in ${filled} boxes on this car's setup sheet, but the app has not yet learned which box is which on this chassis's sheet, so none of them can be read. That gap is the app's, not the driver's: they have already filled the sheet in.`
        : "The driver has not filled in a setup sheet for this car. Once they do, the values the car ran appear here.",
      "No setting on this car can be seen — not a spring, an oil, a toe, a camber or a ride height.",
    ].join("\n");
  }

  const ratio = spurOverPinion(values);
  const missing = leversNotOnSheet(levers, [...chassisSheetKeys(run), ...Object.keys(values)]);
  return [
    `SETUP ON THE CAR (${car}, the session above).`,
    "These are the values the car actually ran. Reason with them; do not read them back.",
    "",
    ...rows.sort(),
    ...(ratio
      ? ["", `spur ÷ pinion: ${ratio} (the final drive ratio is this multiplied by the car's internal ratio, which is not on the sheet)`]
      : []),
    ...(missing.length > 0
      ? ["", `NO BOX ON THIS CAR'S SETUP SHEET FOR: ${missing.join(", ")}. A manufacturer's sheet lists what adjusts on the car.`]
      : []),
  ].join("\n");
}

/**
 * Every car of the SAME TYPE as the anchor's — two chassis of one model share a setup
 * vocabulary, and a driver running both is having one conversation about one platform
 * (founder call 2026-09-01). Falls back to the chassis string, then to the car alone.
 */
async function sameTypeCarIds(userId: string, car: LoadedRun["car"]): Promise<string[]> {
  if (!car) return [];
  const where = car.setupSheetModelId
    ? { userId, setupSheetModelId: car.setupSheetModelId }
    : car.chassis
      ? { userId, chassis: car.chassis }
      : null;
  if (!where) return [car.id];
  const rows = await prisma.car.findMany({ where, select: { id: true } });
  return rows.length > 0 ? rows.map((r) => r.id) : [car.id];
}

/**
 * The anchor's whole local day across cars of that type, plus enough history either side
 * that the first run of the day still has a predecessor to be compared against. The day
 * is resolved in the LOGGING device's zone (`runLocalDayKey`) — the rule the sessions list
 * groups on — or a day straddling UTC midnight arrives here split in two.
 */
function loadRunsAround(userId: string, carIds: string[], centre: number) {
  return prisma.run.findMany({
    where: {
      userId,
      carId: { in: carIds },
      sortAt: { gte: new Date(centre - DAY_WINDOW_MS), lte: new Date(centre + DAY_WINDOW_MS) },
    },
    orderBy: { sortAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      sortAt: true,
      localTimeZone: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
      unconfirmedAt: true,
      carId: true,
      carRating: true,
      tireRunNumber: true,
      // Front/rear cars: the front's own count. Null on every single-tyre run.
      frontTireTypeId: true,
      frontTireRunNumber: true,
      conditionsAirTempC: true,
      lapTimes: true,
      lapSession: true,
      ...FIELD_RUN_SELECT,
      car: { select: { name: true } },
      setupSnapshot: { select: { data: true } },
    },
  });
}

type DayRun = Awaited<ReturnType<typeof loadRunsAround>>[number];

async function loadDayRuns(
  userId: string,
  anchor: LoadedRun,
  zone: string | null
): Promise<{ day: DayRun[]; predecessorOf: Map<string, DayRun> }> {
  const carIds = await sameTypeCarIds(userId, anchor.car);
  const predecessorOf = new Map<string, DayRun>();
  if (carIds.length === 0) return { day: [], predecessorOf };

  const rows = await loadRunsAround(userId, carIds, (anchor.sortAt ?? anchor.createdAt).getTime());
  // The profile zone stands in for runs logged before per-run capture — the same fallback
  // the sessions list uses, so "the day" here is the day the driver sees on screen.
  const zones = { viewerTimeZone: zone ?? undefined };
  const anchorDay = runLocalDayKey(anchor, zones);
  const day = rows.filter((r) => runLocalDayKey(r, zones) === anchorDay);

  // A change belongs to ONE physical car. Two cars of a type sitting side by side in the
  // list must never have their sheets diffed against each other — that is a car swap, not
  // a change the driver made (founder call 2026-09-01).
  const seenPerCar = new Map<string, DayRun>();
  for (const r of rows) {
    const key = r.carId ?? "unknown";
    const prev = seenPerCar.get(key);
    if (prev) predecessorOf.set(r.id, prev);
    seenPerCar.set(key, r);
  }
  return { day, predecessorOf };
}

function buildDayBlock(
  anchor: LoadedRun,
  day: DayRun[],
  predecessorOf: Map<string, DayRun>,
  zone: string | null,
  fieldByRun: Map<string, FieldPace>
): string | null {
  if (day.length < 2) return null;
  const multiCar = new Set(day.map((r) => r.carId)).size > 1;
  const lines: string[] = [];

  for (const run of day) {
    const pace = runPace(run);
    const bits = [
      fmtLocalTime(run, zone),
      multiCar ? (run.car?.name ?? "unknown car") : null,
      fmtSecs(pace.best) ? `best ${fmtSecs(pace.best)}` : "no lap times",
      fmtSecs(pace.top5) ? `top5 ${fmtSecs(pace.top5)}` : null,
      pace.stint ? `5min ${pace.stint}` : null,
      fieldByRun.get(run.id)?.gapBestToP1 != null
        ? `P${fieldByRun.get(run.id)!.rank}/${fieldByRun.get(run.id)!.n} ${fmtDelta(fieldByRun.get(run.id)!.gapBestToP1!)} to P1`
        : null,
      run.carRating != null ? `rated ${run.carRating}/10` : "not rated",
      // A front/rear run states both counts — the ends are separate sets. A single-tyre run's
      // cell is unchanged.
      run.frontTireTypeId != null && run.frontTireRunNumber != null
        ? `tyre run front ${run.frontTireRunNumber} / rear ${run.tireRunNumber}`
        : run.tireRunNumber != null
          ? `tyre run ${run.tireRunNumber}`
          : null,
      run.conditionsAirTempC != null ? `${run.conditionsAirTempC}°C` : null,
      run.unconfirmedAt != null ? "(unconfirmed — setup and tyres carried, not logged by the driver)" : null,
      run.id === anchor.id ? "(the session above)" : null,
    ].filter(Boolean);
    lines.push(bits.join("  "));

    const prev = predecessorOf.get(run.id);
    if (!prev) continue;
    const changes = diffTuning(tuningValues(prev.setupSnapshot?.data), tuningValues(run.setupSnapshot?.data));
    if (changes == null) continue; // No readable sheet one side — unknown, not unchanged.
    const prevDay = fmtLocalDate(prev, zone);
    const thisDay = fmtLocalDate(run, zone);
    const since = prevDay !== thisDay ? ` since the run of ${prevDay}` : "";
    if (changes.length === 0) {
      lines.push(`    no setup change${since}`);
    } else {
      const shown = changes.slice(0, MAX_CHANGES_LISTED).join(", ");
      const more = changes.length > MAX_CHANGES_LISTED ? `, +${changes.length - MAX_CHANGES_LISTED} more` : "";
      lines.push(`    changed${since}: ${shown}${more}`);
    }
  }

  const dayLabel = fmtLocalDate(day[0], zone);
  const what = multiCar ? "cars of this type" : (anchor.car?.name ?? "this car");
  // Only when the day holds one: the sentence is a cost on every other day's block, and the
  // eval fixtures are frozen snapshots of the ordinary shape.
  const anyUnconfirmed = day.some((r) => r.unconfirmedAt != null);
  return [
    // Not "the whole day": a run logged without a car cannot be attributed to a car type,
    // so it is absent here even though the driver was out in it.
    `THIS DAY'S RUNS ON ${multiCar ? "CARS OF THIS TYPE" : "THIS CAR"} — ${dayLabel}, ${what}, ${day.length} runs. Earliest first.`,
    `"changed" is what moved on the setup sheet since that same car's previous run. A run`,
    `with no readable sheet has no "changed" line: that is unknown, not unchanged.`,
    ...(day.some((r) => fieldByRun.has(r.id))
      ? [
          `"P3/12 +0.21 to P1" is your place and gap to the fastest driver's best lap in that session's`,
          `timing sheet — the field drove the same track at the same time, so it cancels the track's movement.`,
        ]
      : []),
    ...(anyUnconfirmed
      ? [
          `An "unconfirmed" run was filed by the app from the timing sheet: its laps are real, but its`,
          `setup and tyres were copied from the previous logged run and the driver has not confirmed`,
          `them. Read its pace; do not read its sheet as a deliberate change.`,
        ]
      : []),
    "",
    ...lines,
  ].join("\n");
}

/**
 * The LAPS block for the session's local day: the timed sessions linked to the day's runs plus
 * any loose import of the driver's whose time on track falls on that day (the sweep files
 * practice without a run). The day is the run's, in the same zone as every other clock here.
 */
async function buildDayLapsBlock(
  userId: string,
  anchor: LoadedRun,
  day: DayRun[],
  zone: string | null
): Promise<string | null> {
  const centre = (anchor.sortAt ?? anchor.createdAt).getTime();
  const anchorDay = runLocalDayKey(anchor, { viewerTimeZone: zone ?? undefined });
  const runs = [anchor, ...day.filter((r) => r.id !== anchor.id)];
  const sessions = await loadLapsSessions({
    userId,
    runs,
    window: { from: new Date(centre - DAY_WINDOW_MS), to: new Date(centre + DAY_WINDOW_MS) },
    zone,
    keep: (s) => s.ymd === anchorDay,
  });
  const where = anchor.track?.name ? ` at ${anchor.track.name}` : "";
  return renderLapsBlock(sessions, `on ${fmtLocalDate(anchor, zone)}${where}`);
}

function buildComparableRunsBlock(
  rows: Awaited<ReturnType<typeof findComparableRunsForEngineer>>,
  zone: string | null
): string | null {
  if (rows.length === 0) return null;
  const lines = rows.map((r) => {
    // whenIso is already the display instant; wrap it so the date and clock print in the
    // same zone as the day block above.
    const asRun = { createdAt: r.whenIso };
    const clock = fmtLocalTime(asRun, zone);
    const when = `${fmtLocalDate(asRun, zone)}${clock ? ` ${clock}` : ""}`;
    const where = r.trackName ? ` at ${r.trackName}` : "";
    const rating = r.carRating != null ? `rated ${r.carRating}/10` : "not rated";
    return `${when}${where} — ${rating}. ${r.howClose}.`;
  });
  return [
    "EARLIER RUNS ON THIS CAR IN THE MOST SIMILAR CONDITIONS.",
    "Closest first. How close each one is decides how much weight it carries — a run that differs",
    "on tyre or grip is weaker evidence, and saying so is better than leaning on it.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * Build the driver-data payload blocks. `runId` null means "their latest run". Returns []
 * when the driver has no runs at all, or the id doesn't resolve to one of their runs.
 */
export async function buildDriverDataBlocks(params: {
  userId: string;
  runId: string | null;
  /** The driver's latest message; a driver named in it gets a VS section over the day (rivals.ts). */
  question?: string | null;
}): Promise<EngineerPayloadBlock[]> {
  const run = await loadRun(params.userId, params.runId).catch(() => null);
  if (!run) return [];

  // The zone every date and clock below is printed in: the run's own, else the driver's
  // profile zone (runs logged before per-run capture), else none — and no clock at all.
  const owner = await prisma.user
    .findUnique({ where: { id: params.userId }, select: { timeZone: true } })
    .catch(() => null);
  const zone = run.localTimeZone ?? owner?.timeZone ?? null;

  const { day, predecessorOf } = await loadDayRuns(params.userId, run, zone).catch(() => ({
    day: [] as DayRun[],
    predecessorOf: new Map<string, DayRun>(),
  }));
  const fieldByRun = await loadFieldPaceForRuns(params.userId, [run, ...day.filter((r) => r.id !== run.id)]).catch(
    () => new Map<string, FieldPace>()
  );

  const parts: string[] = [];
  const facts = buildSessionFactsBlock(run, params.runId == null, zone, fieldByRun.get(run.id) ?? null);
  if (facts) parts.push(facts);
  // The lever list the "no box for" line is checked against. A nets failure must never take the
  // driver's data down with it — no levers just means that one line is not printed.
  const levers = await loadNets({ discipline: "touring" })
    .then((n) => n.entries.map((e) => ({ parameter: e.parameter, label: e.label.toLowerCase() })))
    .catch(() => [] as Array<{ parameter: string; label: string }>);
  parts.push(buildSetupSheetBlock(run, levers, day.filter((r) => r.carId === run.carId)));

  const dayBlock = buildDayBlock(run, day, predecessorOf, zone, fieldByRun);
  if (dayBlock) parts.push(dayBlock);

  // Every lap of every driver in the day's timed sessions (lapsBlock.ts) — the day the
  // session above sits in, whatever car the driver was in. A failed read just drops the block.
  const lapsBlock = await buildDayLapsBlock(params.userId, run, day, zone).catch(() => null);
  if (lapsBlock) parts.push(lapsBlock);

  // Who else was on the day's timing sheets, and — if the question names one — you against
  // them session by session. The day's runs, the session itself included.
  const dayRuns: RivalRun[] = (day.length > 0 ? day : [run]).map((r) => ({
    dateYmd: fmtLocalDate(r, zone),
    clock: fmtLocalTime(r, zone),
    trackName: run.track?.name ?? null,
    session: null,
    field: fieldByRun.get(r.id) ?? null,
  }));
  const rivals = renderRivalsSummary(dayRuns);
  if (rivals) parts.push(rivals);
  const rivalName = params.question
    ? matchDriverName(params.question, driversOnSheets(dayRuns).map((d) => d.name))
    : null;
  if (rivalName) {
    const vs = renderRivalSection(dayRuns, driverKey(rivalName));
    if (vs) parts.push(vs);
  }

  const rows = await findComparableRunsForEngineer(params.userId, run.id, { limit: 3 }).catch(
    () => []
  );
  const comparable = buildComparableRunsBlock(rows, zone);
  if (comparable) parts.push(comparable);

  if (parts.length === 0) return [];
  return [{ id: "driver-data", cacheStable: false, content: parts.join("\n\n") }];
}
