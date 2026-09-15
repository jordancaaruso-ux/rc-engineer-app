import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverNameSetting, getSpeedhiveTransponderCarsSetting } from "@/lib/appSettings";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { parseTransponderCarsSetting } from "@/lib/speedhive/transponderCars";
import { importOneTimingUrl } from "@/lib/lapImport/service";
import { sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { importedSessionInstantToReal } from "@/lib/runSessionCompletedAt";
import { todayBoundsInTimeZone } from "@/lib/eventActive";
import { createBackfilledRuns } from "@/lib/runs/createBackfilledRuns";
import { applyRunWindow } from "@/lib/runs/runWindow";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { attachSessionToClaimant } from "@/lib/sweep/attachSessionToRun";
import { planDraftClaims, type DraftClaimant } from "@/lib/sweep/planDraftClaims";
import { resolveSweepCar } from "@/lib/sweep/resolveSweepCar";
import type { SweepSource } from "@/lib/sweep/sweepDocs";
import { isSweepListenerEmail, sweepListenerAllowlist } from "@/lib/sweep/sweepListeners";

/** Nobody drives more heats than this in a day; a runaway listing must not fill a log. */
const MAX_FILINGS_PER_USER_PER_DAY = 20;

export type FileSessionInput = {
  userId: string;
  track: { id: string; timeZone: string };
  sessionUrl: string;
  source: SweepSource;
  sourceKind: "practice" | "race";
  /** The chip the session was matched by, when it was (Speedhive); drives the chip→car binding. */
  chipCode?: string | null;
  now?: Date;
};

export type FileSessionOutcome =
  | { kind: "attached"; runId: string; instant: Date; bestLapSeconds: number | null }
  | { kind: "placeholder"; runId: string; instant: Date; bestLapSeconds: number | null }
  | { kind: "loose"; importedSessionId: string; instant: Date | null }
  | { kind: "skipped"; reason: string };

/**
 * One timing session, one driver — the claiming rules end to end:
 *
 *   1. import (or re-read) the session under the driver's identity;
 *   2. an open draft / lap-less run of theirs at that track today claims it forward → attach;
 *   3. else a car the driver established (earlier run today, chip binding, only car) → placeholder;
 *   4. else the import stays LOOSE and the evening summary asks which car.
 *
 * Every step is idempotent: a session already on a run is skipped, claims happen inside
 * transactions, and the import row is one-per-URL.
 */
export async function fileSessionForUser(input: FileSessionInput): Promise<FileSessionOutcome> {
  const now = input.now ?? new Date();
  const { userId, track } = input;

  // Belt and braces with the plan filter: never write for an account outside the listener list.
  const allow = sweepListenerAllowlist();
  if (allow !== null) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!isSweepListenerEmail(u?.email, allow)) return { kind: "skipped", reason: "not a listener" };
  }

  const [liveName, speedhiveNames, transponders, carsRaw] = await Promise.all([
    getLiveRcDriverNameSetting(userId).catch(() => null),
    getSpeedhiveDriverNamesForUser(userId).catch(() => [] as string[]),
    getSpeedhiveTransponderNumbersForUser(userId).catch(() => [] as number[]),
    getSpeedhiveTransponderCarsSetting(userId).catch(() => null),
  ]);
  const driverName = (speedhiveNames[0] ?? liveName)?.trim() ?? "";
  const imported = await importOneTimingUrl(userId, input.sessionUrl, {
    ...(driverName ? { driverName } : {}),
    ...(speedhiveNames.length > 0 ? { speedhiveDriverNames: speedhiveNames } : {}),
    ...(transponders.length > 0 ? { speedhiveTransponderNumbers: transponders } : {}),
  });
  if (!imported.success) return { kind: "skipped", reason: `import: ${imported.error}` };

  const row = await prisma.importedLapTimeSession.findFirst({
    where: { id: imported.importedSessionId, userId },
    select: {
      id: true,
      sourceUrl: true,
      parsedPayload: true,
      sessionCompletedAt: true,
      linkedRunId: true,
      sweepFiledAt: true,
      trackId: true,
    },
  });
  if (!row) return { kind: "skipped", reason: "import row missing" };
  if (row.linkedRunId) return { kind: "skipped", reason: "already on a run" };
  if (!row.sweepFiledAt || row.trackId !== track.id) {
    await prisma.importedLapTimeSession.update({
      where: { id: row.id },
      data: { sweepFiledAt: row.sweepFiledAt ?? now, trackId: track.id },
    });
  }

  const rawIso =
    row.sessionCompletedAt?.toISOString() ?? sessionCompletedAtIsoFromImportedPayload(row.parsedPayload);
  if (!rawIso) return { kind: "loose", importedSessionId: row.id, instant: null };
  const instant = importedSessionInstantToReal(new Date(rawIso), row.sourceUrl, track.timeZone);
  const day = todayBoundsInTimeZone(track.timeZone, instant);

  const filedToday = await prisma.run.count({
    where: {
      userId,
      OR: [{ filedBySweepAt: { gte: day.start } }, { lapsAttachedBySweepAt: { gte: day.start } }],
    },
  });
  if (filedToday >= MAX_FILINGS_PER_USER_PER_DAY) {
    return { kind: "skipped", reason: "daily filing cap" };
  }

  // 2. A run the driver opened at this track today with no laps yet claims forward.
  const openRuns = await prisma.run.findMany({
    where: {
      userId,
      trackId: track.id,
      importedLapTimeSessionId: null,
      unconfirmedAt: null,
      OR: [
        { createdAt: { gte: day.start, lt: day.end } },
        { sortAt: { gte: day.start, lt: day.end } },
      ],
    },
    select: { id: true, createdAt: true, sortAt: true, loggingComplete: true, lapTimes: true },
  });
  const claimants: DraftClaimant[] = [];
  for (const r of openRuns) {
    const lapless = !Array.isArray(r.lapTimes) || r.lapTimes.length === 0;
    if (!lapless) continue;
    if (!r.loggingComplete) claimants.push({ id: r.id, anchor: r.createdAt });
    else claimants.push({ id: r.id, anchor: r.sortAt });
  }
  const claimPlan = planDraftClaims({ claimants, sessions: [{ id: row.id, instant }] });
  const claim = claimPlan.claims[0];
  if (claim) {
    const attached = await attachSessionToClaimant({
      userId,
      runId: claim.claimantId,
      importedLapTimeSessionId: row.id,
      zone: track.timeZone,
    });
    if (attached.status === "attached") {
      await settle(userId);
      const best = await bestLapOf(claim.claimantId);
      return { kind: "attached", runId: claim.claimantId, instant, bestLapSeconds: best };
    }
    if (attached.status === "already_linked") return { kind: "skipped", reason: "already on a run" };
    // Any other status (no laps, no time) falls through to the placeholder path, which will
    // report the same condition through `createBackfilledRuns`' skip reasons.
  }

  // 3. A car the driver established.
  const [dayRuns, cars] = await Promise.all([
    prisma.run.findMany({
      where: { userId, trackId: track.id, sortAt: { gte: day.start, lt: day.end } },
      select: { carId: true, sortAt: true, sessionCompletedAt: true },
    }),
    prisma.car.findMany({ where: { userId }, select: { id: true } }),
  ]);
  const chipCars = parseTransponderCarsSetting(carsRaw);
  const chipCarId = input.chipCode ? (chipCars[input.chipCode] ?? null) : null;
  const car = resolveSweepCar({
    instant,
    dayRunsAtTrack: dayRuns.map((r) => ({ carId: r.carId, instant: r.sessionCompletedAt ?? r.sortAt })),
    chipCarId,
    userCarIds: cars.map((c) => c.id),
  });
  if (!car) return { kind: "loose", importedSessionId: row.id, instant };

  const created = await createBackfilledRuns({
    userId,
    context: {
      kind: "track",
      trackId: track.id,
      carId: car.carId,
      zone: track.timeZone,
      sessionType: input.sourceKind === "race" ? "RACE_MEETING" : "TESTING",
      meetingSessionType: input.sourceKind === "race" ? "RACE" : null,
    },
    importedLapTimeSessionIds: [row.id],
    deviceTimeZone: track.timeZone,
    filedBySweep: true,
  });
  const made = created.created[0];
  if (!made) {
    const reason = created.skipped[0]?.reason ?? "not created";
    return { kind: "skipped", reason: `placeholder: ${reason}` };
  }
  await settle(userId);
  const best = await bestLapOf(made.runId);
  return { kind: "placeholder", runId: made.runId, instant, bestLapSeconds: best };
}

async function settle(userId: string): Promise<void> {
  await applyRunWindow(userId);
  revalidateAfterRunMutation(userId);
}

async function bestLapOf(runId: string): Promise<number | null> {
  const r = await prisma.run.findUnique({ where: { id: runId }, select: { bestLapSeconds: true } });
  return r?.bestLapSeconds ?? null;
}
