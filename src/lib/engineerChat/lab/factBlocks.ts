import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeSetupData } from "@/lib/runSetup";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { findComparableRunsForEngineer } from "@/lib/engineerPhase5/findComparableRuns";
import type { EngineerLabRungId } from "@/lib/engineerChat/lab/labFlags";

/**
 * Facts, not instructions.
 *
 * Every block here is a plain statement of something true about this car and this session. None
 * of them tell the model how to think, in what order, or what to conclude — that was the old
 * pipeline's mistake and it lost a blind 5-0. If a rung ever needs a paragraph of guidance to be
 * useful, the rung is wrong, not the guidance.
 *
 * Keep them short. The whole point of measuring one rung at a time is being able to say what a
 * given block bought, and a block nobody can read the effect of has not earned anything.
 */

const MAX_SETUP_ROWS = 120;

function fmtValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "string") {
    const t = v.trim();
    return t && t !== "[object Object]" ? t : null;
  }
  if (typeof v === "object") {
    const o = v as { preset?: unknown; other?: unknown; value?: unknown };
    for (const candidate of [o.other, o.preset, o.value]) {
      const s = fmtValue(candidate);
      if (s) return s;
    }
    return null;
  }
  return null;
}

/** `front_spring_rate_gf_mm` -> `front spring rate gf mm` — readable without inventing a label. */
function readableKey(key: string): string {
  return key.replace(/_/g, " ");
}

function fmtWhen(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Date plus time of day. A practice day puts several runs on one date, and without the clock
 * they render as three identical lines that say nothing about which is which.
 */
function fmtWhenPrecise(iso: string): string {
  const time = iso.slice(11, 16);
  return time ? `${iso.slice(0, 10)} ${time}` : iso.slice(0, 10);
}

export type LabRunContext = {
  runId: string;
  userId: string;
};

/** Resolve which run the chat is about. Only a run-kind anchor points at one. */
export function labRunIdFromAnchor(anchor: unknown, fallbackRunId: string): string | null {
  if (anchor && typeof anchor === "object") {
    const a = anchor as { kind?: unknown; id?: unknown };
    if (a.kind === "run" && typeof a.id === "string" && a.id.trim()) return a.id.trim();
  }
  return fallbackRunId.trim() || null;
}

async function loadRun(userId: string, runId: string) {
  return prisma.run.findFirst({
    where: { id: runId, userId },
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
    `SETUP ON THE CAR (${car}, the session being discussed).`,
    "These are the values the car actually ran. Reason with them; do not read them back.",
    "",
    ...rows.sort(),
  ].join("\n");
}

function buildSessionFactsBlock(run: LoadedRun): string | null {
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
  return ["THE SESSION BEING DISCUSSED.", "", ...facts].join("\n");
}

function buildComparableRunsBlock(
  rows: Awaited<ReturnType<typeof findComparableRunsForEngineer>>
): string | null {
  if (rows.length === 0) return null;
  const lines = rows.map((r) => {
    const where = r.trackName ? ` at ${r.trackName}` : "";
    const rating =
      r.carRating != null ? `rated ${r.carRating}/10` : "not rated";
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
 * Build the fact blocks for the active rungs. Returns [] whenever there is no run to talk about,
 * so an unanchored question in the lab is identical to an unanchored question without it.
 */
export async function buildEngineerLabFactBlocks(params: {
  userId: string;
  runId: string | null;
  rungs: EngineerLabRungId[];
}): Promise<string[]> {
  if (params.rungs.length === 0 || !params.runId) return [];

  const run = await loadRun(params.userId, params.runId).catch(() => null);
  if (!run) return [];

  const blocks: string[] = [];
  for (const rung of params.rungs) {
    if (rung === "setupSheet") {
      const b = buildSetupSheetBlock(run);
      if (b) blocks.push(b);
    } else if (rung === "sessionFacts") {
      const b = buildSessionFactsBlock(run);
      if (b) blocks.push(b);
    } else if (rung === "comparableRuns") {
      const rows = await findComparableRunsForEngineer(params.userId, run.id, { limit: 3 }).catch(
        () => []
      );
      const b = buildComparableRunsBlock(rows);
      if (b) blocks.push(b);
    }
  }
  return blocks;
}
