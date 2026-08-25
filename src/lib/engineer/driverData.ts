import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeSetupData } from "@/lib/runSetup";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { findComparableRunsForEngineer } from "@/lib/engineer/findComparableRuns";
import type { EngineerPayloadBlock } from "@/lib/engineer/payload";

/**
 * Driver-data blocks: the driver's own latest session, its setup, and the nearest earlier
 * runs, fed to the Engineer as per-turn payload blocks.
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

async function loadRun(userId: string, runId: string | null) {
  return prisma.run.findFirst({
    where: runId ? { id: runId, userId } : { userId },
    orderBy: runId ? undefined : { sortAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
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
      car: { select: { name: true, chassis: true } },
      track: { select: { name: true, gripTags: true, layoutTags: true } },
      trackLayout: { select: { name: true } },
      tireType: { select: { displayName: true, modelCode: true } },
      additiveType: { select: { displayName: true } },
      lapTimes: true,
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
  push("laps recorded", Array.isArray(run.lapTimes) ? run.lapTimes.length || null : null);
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
  const rows = await findComparableRunsForEngineer(params.userId, run.id, { limit: 3 }).catch(
    () => []
  );
  const comparable = buildComparableRunsBlock(rows);
  if (comparable) parts.push(comparable);

  if (parts.length === 0) return [];
  return [{ id: "driver-data", cacheStable: false, content: parts.join("\n\n") }];
}
