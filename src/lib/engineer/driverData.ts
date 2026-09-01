import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeSetupData } from "@/lib/runSetup";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
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
import type { EngineerPayloadBlock } from "@/lib/engineer/payload";

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

function fmtValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length > 0 && s.length <= 60 ? s : null;
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
}

/** `front_spring_rate_gf_mm` -> `front spring rate gf mm` — readable without inventing a label. */
function readableKey(key: string): string {
  return key.replace(/[_\-]+/g, " ").trim();
}

function fmtWhen(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Date plus time of day. A practice day puts several runs on one date, and without the
 * clock they render as identical lines that say nothing about which is which.
 */
function fmtWhenPrecise(iso: string): string {
  const time = iso.slice(11, 16);
  return time ? `${iso.slice(0, 10)} ${time}` : iso.slice(0, 10);
}

function fmtSecs(v: number | null | undefined): string | null {
  return v == null || !Number.isFinite(v) ? null : v.toFixed(2);
}

/**
 * Time of day in the zone the run was logged in. A run's clock belongs to the driver who
 * was there, not to whoever is reading — the same rule the sessions list groups on.
 */
function fmtLocalTime(instant: Date, zone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: zone ?? undefined,
    }).format(instant);
  } catch {
    return instant.toISOString().slice(11, 16);
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

/** The tuning keys only — the blob also carries tyres, battery, body and free text. */
function tuningValues(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(normalizeSetupData(data))) {
    if (!isTuningComparisonKey(key)) continue;
    const value = fmtValue(raw);
    if (value) out[key] = value;
  }
  return out;
}

/**
 * What moved between two sheets. Null — not an empty list — when either side has no
 * readable setup: only a calibrated sheet gives values, and "nothing changed" and "we
 * cannot see the setup" are different facts (founder call 2026-09-01).
 */
function diffTuning(prev: Record<string, string>, next: Record<string, string>): string[] | null {
  if (Object.keys(prev).length === 0 || Object.keys(next).length === 0) return null;
  const changes: string[] = [];
  for (const key of [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort()) {
    if (sameSetupValue(prev[key], next[key])) continue;
    changes.push(`${readableKey(key)} ${prev[key] ?? "—"} → ${next[key] ?? "—"}`);
  }
  return changes;
}

/**
 * `1` and `1.0`, or `STD` and `std`, are the same setting written twice — not a change the
 * driver made. Sheets store what was keyed, and canonicalising the box labels (2026-09-01)
 * recased a batch of preset values, so a naive string compare reports a day's worth of
 * changes nobody touched. Numbers compare as numbers, text ignores case and padding.
 */
function sameSetupValue(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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
      car: { select: { id: true, name: true, chassis: true, setupSheetModelId: true } },
      track: { select: { name: true, gripTags: true, layoutTags: true } },
      trackLayout: { select: { name: true } },
      tireType: { select: { displayName: true, modelCode: true } },
      additiveType: { select: { displayName: true } },
      lapTimes: true,
      lapSession: true,
    },
  });
}

type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

function buildSessionFactsBlock(run: LoadedRun, latestFallback: boolean): string | null {
  const facts: string[] = [];
  const push = (label: string, value: string | number | null | undefined) => {
    if (value == null || value === "") return;
    facts.push(`${label}: ${value}`);
  };

  push("car", run.car?.name ?? run.car?.chassis);
  push("class", run.raceClass);
  push("track", run.track?.name);
  push("layout", run.trackLayout?.name ?? run.trackLayoutNameSnapshot);
  push("direction", run.trackDirection);
  push(
    "grip",
    run.gripLevel ?? (run.track?.gripTags?.length ? run.track.gripTags.join(", ") : null)
  );
  push("layout style", run.track?.layoutTags?.length ? run.track.layoutTags.join(", ") : null);
  push("tyre", run.tireType?.displayName ?? run.tireType?.modelCode);
  push("tyre run number", run.tireRunNumber);
  push("additive", run.additiveType?.displayName);
  push("air temp °C", run.conditionsAirTempC);
  push("track temp °C", run.conditionsTrackTempC);
  push("humidity %", run.conditionsHumidityPct);

  const pace = runPace(run);
  push("laps recorded", pace.lapCount || null);
  push("best lap (s)", fmtSecs(pace.best));
  push("average of the best 5 laps (s)", fmtSecs(pace.top5));
  push("best five minutes (laps/time)", pace.stint);
  push("driver's rating of the car (1-10)", run.carRating);
  push("session date", fmtWhen((run.sessionCompletedAt ?? run.createdAt).toISOString()));

  if (facts.length === 0) return null;
  const heading = latestFallback
    ? "THE DRIVER'S MOST RECENT LOGGED SESSION. Unless they say otherwise, assume questions about \"the car\" mean this one."
    : "THE SESSION BEING DISCUSSED.";
  return [heading, "", ...facts].join("\n");
}

function buildSetupSheetBlock(run: LoadedRun): string | null {
  const data = normalizeSetupData(run.setupSnapshot?.data);
  const rows: string[] = [];
  for (const [key, raw] of Object.entries(data)) {
    if (!isTuningComparisonKey(key)) continue;
    const value = fmtValue(raw);
    if (!value) continue;
    rows.push(`${readableKey(key)}: ${value}`);
    if (rows.length >= MAX_SETUP_ROWS) break;
  }
  if (rows.length === 0) return null;
  const car = run.car?.name ?? run.car?.chassis ?? "this car";
  return [
    `SETUP ON THE CAR (${car}, the session above).`,
    "These are the values the car actually ran. Reason with them; do not read them back.",
    "",
    ...rows.sort(),
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
      carId: true,
      carRating: true,
      tireRunNumber: true,
      conditionsAirTempC: true,
      lapTimes: true,
      lapSession: true,
      car: { select: { name: true } },
      setupSnapshot: { select: { data: true } },
    },
  });
}

type DayRun = Awaited<ReturnType<typeof loadRunsAround>>[number];

async function loadDayRuns(
  userId: string,
  anchor: LoadedRun
): Promise<{ day: DayRun[]; predecessorOf: Map<string, DayRun> }> {
  const carIds = await sameTypeCarIds(userId, anchor.car);
  const predecessorOf = new Map<string, DayRun>();
  if (carIds.length === 0) return { day: [], predecessorOf };

  const rows = await loadRunsAround(userId, carIds, (anchor.sortAt ?? anchor.createdAt).getTime());
  const anchorDay = runLocalDayKey(anchor);
  const day = rows.filter((r) => runLocalDayKey(r) === anchorDay);

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
  predecessorOf: Map<string, DayRun>
): string | null {
  if (day.length < 2) return null;
  const zone = anchor.localTimeZone ?? null;
  const multiCar = new Set(day.map((r) => r.carId)).size > 1;
  const lines: string[] = [];

  for (const run of day) {
    const pace = runPace(run);
    const bits = [
      fmtLocalTime(run.sessionCompletedAt ?? run.createdAt, zone),
      multiCar ? (run.car?.name ?? "unknown car") : null,
      fmtSecs(pace.best) ? `best ${fmtSecs(pace.best)}` : "no lap times",
      fmtSecs(pace.top5) ? `top5 ${fmtSecs(pace.top5)}` : null,
      pace.stint ? `5min ${pace.stint}` : null,
      run.carRating != null ? `rated ${run.carRating}/10` : "not rated",
      run.tireRunNumber != null ? `tyre run ${run.tireRunNumber}` : null,
      run.conditionsAirTempC != null ? `${run.conditionsAirTempC}°C` : null,
      run.id === anchor.id ? "(the session above)" : null,
    ].filter(Boolean);
    lines.push(bits.join("  "));

    const prev = predecessorOf.get(run.id);
    if (!prev) continue;
    const changes = diffTuning(tuningValues(prev.setupSnapshot?.data), tuningValues(run.setupSnapshot?.data));
    if (changes == null) continue; // No readable sheet one side — unknown, not unchanged.
    const prevDay = fmtWhen((prev.sessionCompletedAt ?? prev.createdAt).toISOString());
    const thisDay = fmtWhen((run.sessionCompletedAt ?? run.createdAt).toISOString());
    const since = prevDay !== thisDay ? ` since the run of ${prevDay}` : "";
    if (changes.length === 0) {
      lines.push(`    no setup change${since}`);
    } else {
      const shown = changes.slice(0, MAX_CHANGES_LISTED).join(", ");
      const more = changes.length > MAX_CHANGES_LISTED ? `, +${changes.length - MAX_CHANGES_LISTED} more` : "";
      lines.push(`    changed${since}: ${shown}${more}`);
    }
  }

  const dayLabel = fmtWhen((day[0].sessionCompletedAt ?? day[0].createdAt).toISOString());
  const what = multiCar ? "cars of this type" : (anchor.car?.name ?? "this car");
  return [
    // Not "the whole day": a run logged without a car cannot be attributed to a car type,
    // so it is absent here even though the driver was out in it.
    `THIS DAY'S RUNS ON ${multiCar ? "CARS OF THIS TYPE" : "THIS CAR"} — ${dayLabel}, ${what}, ${day.length} runs. Earliest first.`,
    `"changed" is what moved on the setup sheet since that same car's previous run. A run`,
    `with no readable sheet has no "changed" line: that is unknown, not unchanged.`,
    "",
    ...lines,
  ].join("\n");
}

function buildComparableRunsBlock(
  rows: Awaited<ReturnType<typeof findComparableRunsForEngineer>>
): string | null {
  if (rows.length === 0) return null;
  const lines = rows.map((r) => {
    const where = r.trackName ? ` at ${r.trackName}` : "";
    const rating = r.carRating != null ? `rated ${r.carRating}/10` : "not rated";
    return `${fmtWhenPrecise(r.whenIso)}${where} — ${rating}. ${r.howClose}.`;
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
}): Promise<EngineerPayloadBlock[]> {
  const run = await loadRun(params.userId, params.runId).catch(() => null);
  if (!run) return [];

  const parts: string[] = [];
  const facts = buildSessionFactsBlock(run, params.runId == null);
  if (facts) parts.push(facts);
  const setup = buildSetupSheetBlock(run);
  if (setup) parts.push(setup);

  const { day, predecessorOf } = await loadDayRuns(params.userId, run).catch(() => ({
    day: [] as DayRun[],
    predecessorOf: new Map<string, DayRun>(),
  }));
  const dayBlock = buildDayBlock(run, day, predecessorOf);
  if (dayBlock) parts.push(dayBlock);

  const rows = await findComparableRunsForEngineer(params.userId, run.id, { limit: 3 }).catch(
    () => []
  );
  const comparable = buildComparableRunsBlock(rows);
  if (comparable) parts.push(comparable);

  if (parts.length === 0) return [];
  return [{ id: "driver-data", cacheStable: false, content: parts.join("\n\n") }];
}
