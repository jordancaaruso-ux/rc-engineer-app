import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverNameSetting, getSpeedhiveTransponderCarsSetting } from "@/lib/appSettings";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { parseTransponderCarsSetting } from "@/lib/speedhive/transponderCars";
import { importOneTimingUrl } from "@/lib/lapImport/service";
import { todayBoundsInTimeZone } from "@/lib/eventActive";
import { createBackfilledRuns } from "@/lib/runs/createBackfilledRuns";
import { groupOutings, type OutingSession } from "@/lib/runs/groupOutings";
import { spansOverlap, type Span } from "@/lib/runs/outingSpan";
import {
  outingSessionFromImportedRow,
  spanForExistingRun,
  type ImportedRowForOuting,
} from "@/lib/runs/outingsFromImportedSessions";
import { applyRunWindow } from "@/lib/runs/runWindow";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { attachSessionToClaimant } from "@/lib/sweep/attachSessionToRun";
import { planDraftClaims, type DraftClaimant } from "@/lib/sweep/planDraftClaims";
import { resolveSweepCar } from "@/lib/sweep/resolveSweepCar";
import type { SweepSource } from "@/lib/sweep/sweepDocs";
import { isSweepListenerEmail, sweepListenerAllowlist } from "@/lib/sweep/sweepListeners";

/** Nobody drives more heats than this in a day; a runaway listing must not fill a log. */
const MAX_FILINGS_PER_USER_PER_DAY = 20;
/** Imports read one timing page each; a few at once keeps a big day quick without a burst. */
const IMPORT_CONCURRENCY = 3;

/** One session as a gatherer found it — a URL and where it came from. */
export type GatheredCandidate = {
  sessionUrl: string;
  source: SweepSource;
  sourceKind: "practice" | "race";
  /** The chip the session was matched by, when it was (Speedhive); drives the chip→car binding. */
  chipCode?: string | null;
};

export type FileOutcome =
  | { kind: "attached"; runId: string; instant: Date; bestLapSeconds: number | null }
  | { kind: "placeholder"; runId: string; instant: Date; bestLapSeconds: number | null }
  /** The outing overlapped a run the driver already had that day: its sessions joined that run. */
  | { kind: "joined"; runId: string; importedSessionIds: string[] }
  | { kind: "loose"; importedSessionId: string; instant: Date | null }
  | { kind: "skipped"; reason: string };

/** An imported session, ready to file. */
export type FilingRow = ImportedRowForOuting & {
  chipCode: string | null;
  sourceKind: "practice" | "race";
};

/**
 * Who is filing. `evening`: the 8 pm pass, acting for a driver who is not there, so the listener
 * allowlist applies. `driver`: the driver pressed "Get my day" and is acting for themselves.
 */
export type FileTrigger = "evening" | "driver";

type FilingTrack = { id: string; timeZone: string };

const DAY_RUN_SELECT = {
  id: true,
  carId: true,
  createdAt: true,
  sortAt: true,
  sessionCompletedAt: true,
  loggingComplete: true,
  unconfirmedAt: true,
  lapTimes: true,
  localTimeZone: true,
  importedLapTimeSessionId: true,
  detectedImportedLapSession: {
    select: { id: true, sourceUrl: true, parserId: true, parsedPayload: true, sessionCompletedAt: true },
  },
} as const;

type KnownRun = {
  id: string;
  carId: string | null;
  instant: Date;
  /** Time on track, when the run has laps. */
  span: Span | null;
  /** Set while the run is a draft / lap-less logged run that may claim an outing forward. */
  claimant: DraftClaimant | null;
};

/**
 * One driver's day at one track, filed once — the claiming rules end to end, on OUTINGS rather
 * than raw sessions (founder rulings 2026-09-14 and 2026-09-15):
 *
 *   1. import every session the gatherers found, from every source, before filing anything;
 *   2. group them into outings — windows that overlap are one time on track, and the official
 *      record leads (`groupOutings.ts`);
 *   3. an outing that overlaps a run the driver already has that day joins it as a linked source;
 *   4. else an open draft / lap-less run of theirs at that track that day claims it forward;
 *   5. else a car the driver established (earlier run that day, chip binding, only car) makes a
 *      placeholder run;
 *   6. else the import stays LOOSE and the driver is asked which car.
 *
 * Every step is idempotent: a session already on a run is skipped, claims happen inside
 * transactions, and the import row is one-per-URL. Called by the 8 pm pass and by "Get my day".
 */
export async function fileDayForUser(input: {
  userId: string;
  track: FilingTrack;
  candidates: readonly GatheredCandidate[];
  now?: Date;
  trigger?: FileTrigger;
}): Promise<FileOutcome[]> {
  const now = input.now ?? new Date();
  const outcomes: FileOutcome[] = [];
  if (input.candidates.length === 0) return outcomes;

  // Belt and braces with the plan filter: the evening pass never writes for an account outside the
  // listener list. A driver pressing "Get my day" is acting for themselves.
  if ((input.trigger ?? "evening") === "evening" && !(await isListener(input.userId))) {
    return [{ kind: "skipped", reason: "not a listener" }];
  }

  const rows = await importCandidates(input.userId, input.track, input.candidates, now, outcomes);
  if (rows.length === 0) return outcomes;
  return fileRows({ userId: input.userId, track: input.track, rows, carId: null, outcomes });
}

/**
 * The second half of "Get my day": sessions it imported but could not give a car, filed with the
 * car the driver named. Nothing is read from the timing sites again.
 */
export async function fileImportedRowsForUser(input: {
  userId: string;
  track: FilingTrack;
  rows: readonly FilingRow[];
  carId: string;
}): Promise<FileOutcome[]> {
  if (input.rows.length === 0) return [];
  return fileRows({
    userId: input.userId,
    track: input.track,
    rows: [...input.rows],
    carId: input.carId,
    outcomes: [],
  });
}

/** Step 1: the whole day in hand before anything is filed. */
async function importCandidates(
  userId: string,
  track: FilingTrack,
  candidates: readonly GatheredCandidate[],
  now: Date,
  outcomes: FileOutcome[],
): Promise<FilingRow[]> {
  const [liveName, speedhiveNames, transponders] = await Promise.all([
    getLiveRcDriverNameSetting(userId).catch(() => null),
    getSpeedhiveDriverNamesForUser(userId).catch(() => [] as string[]),
    getSpeedhiveTransponderNumbersForUser(userId).catch(() => [] as number[]),
  ]);
  const driverName = (speedhiveNames[0] ?? liveName)?.trim() ?? "";
  const importContext = {
    ...(driverName ? { driverName } : {}),
    ...(speedhiveNames.length > 0 ? { speedhiveDriverNames: speedhiveNames } : {}),
    ...(transponders.length > 0 ? { speedhiveTransponderNumbers: transponders } : {}),
  };

  const unique: GatheredCandidate[] = [];
  const seenUrls = new Set<string>();
  for (const c of candidates) {
    const url = c.sessionUrl.trim();
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    unique.push({ ...c, sessionUrl: url });
  }

  const rows: FilingRow[] = [];
  await forEachPooled(unique, IMPORT_CONCURRENCY, async (c) => {
    try {
      const imported = await importOneTimingUrl(userId, c.sessionUrl, importContext);
      if (!imported.success) {
        outcomes.push({ kind: "skipped", reason: `import: ${imported.error}` });
        return;
      }
      const row = await prisma.importedLapTimeSession.findFirst({
        where: { id: imported.importedSessionId, userId },
        select: {
          id: true,
          sourceUrl: true,
          parserId: true,
          parsedPayload: true,
          sessionCompletedAt: true,
          linkedRunId: true,
          sweepFiledAt: true,
          trackId: true,
        },
      });
      if (!row) {
        outcomes.push({ kind: "skipped", reason: "import row missing" });
        return;
      }
      if (!row.sweepFiledAt || row.trackId !== track.id) {
        await prisma.importedLapTimeSession.update({
          where: { id: row.id },
          data: { sweepFiledAt: row.sweepFiledAt ?? now, trackId: track.id },
        });
      }
      if (row.linkedRunId) {
        outcomes.push({ kind: "skipped", reason: "already on a run" });
        return;
      }
      rows.push({
        id: row.id,
        sourceUrl: row.sourceUrl,
        parserId: row.parserId,
        parsedPayload: row.parsedPayload,
        sessionCompletedAt: row.sessionCompletedAt,
        chipCode: c.chipCode ?? null,
        sourceKind: c.sourceKind,
      });
    } catch (err) {
      outcomes.push({ kind: "skipped", reason: `import: ${err instanceof Error ? err.message : "failed"}` });
    }
  });
  return rows;
}

/** Steps 2–6: outings, then join / claim / placeholder / loose, one outing at a time. */
async function fileRows(ctx: {
  userId: string;
  track: FilingTrack;
  rows: FilingRow[];
  /** The car the driver named ("Get my day" → which car?). Null: resolve it, never guess. */
  carId: string | null;
  outcomes: FileOutcome[];
}): Promise<FileOutcome[]> {
  const { userId, track, rows, outcomes } = ctx;
  const zone = track.timeZone;

  // 2. Windows on track, then outings.
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const sessions: OutingSession[] = [];
  for (const row of rows) {
    const s = outingSessionFromImportedRow(row, zone);
    if (!s) {
      // No time on the page: nothing to place it by. Loose, and the driver is asked.
      outcomes.push({ kind: "loose", importedSessionId: row.id, instant: null });
      continue;
    }
    sessions.push(s);
  }
  if (sessions.length === 0) return outcomes;
  const outings = groupOutings(sessions);

  // 3. The day as it stands: every run at this track that day, whatever its state.
  const earliest = outings.reduce((a, b) => (a.start < b.start ? a : b)).start;
  const day = todayBoundsInTimeZone(zone, earliest);
  const [dayRuns, cars, filedCount, carsRaw] = await Promise.all([
    prisma.run.findMany({
      where: {
        userId,
        trackId: track.id,
        OR: [
          { createdAt: { gte: day.start, lt: day.end } },
          { sortAt: { gte: day.start, lt: day.end } },
        ],
      },
      select: DAY_RUN_SELECT,
    }),
    prisma.car.findMany({ where: { userId }, select: { id: true } }),
    // Runs the app filed or filled for that DAY, by when they were on track — a press for last
    // Saturday counts Saturday, not everything the app has written since.
    prisma.run.count({
      where: {
        userId,
        sortAt: { gte: day.start, lt: day.end },
        OR: [{ filedBySweepAt: { not: null } }, { lapsAttachedBySweepAt: { not: null } }],
      },
    }),
    getSpeedhiveTransponderCarsSetting(userId).catch(() => null),
  ]);
  const known: KnownRun[] = dayRuns.map((r) => {
    const lapless = !Array.isArray(r.lapTimes) || r.lapTimes.length === 0;
    const claimant: DraftClaimant | null =
      lapless && !r.unconfirmedAt && !r.importedLapTimeSessionId
        ? { id: r.id, anchor: r.loggingComplete ? r.sortAt : r.createdAt }
        : null;
    return {
      id: r.id,
      carId: r.carId,
      instant: r.sessionCompletedAt ?? r.sortAt,
      span: spanForExistingRun(r, zone),
      claimant,
    };
  });
  const userCarIds = cars.map((c) => c.id);
  const chipCars = parseTransponderCarsSetting(carsRaw);
  let filedToday = filedCount;

  for (const outing of outings) {
    const primaryRow = rowById.get(outing.primaryId)!;
    const secondaries = outing.sessionIds.filter((id) => id !== outing.primaryId);

    // 3. Same time on track as a run the driver already has: join it, never open a second one.
    const host = known.find((k) => k.span && spansOverlap(k.span, outing));
    if (host) {
      await linkSessions(userId, host.id, outing.sessionIds);
      host.span = {
        start: host.span!.start < outing.start ? host.span!.start : outing.start,
        end: host.span!.end > outing.end ? host.span!.end : outing.end,
      };
      outcomes.push({ kind: "joined", runId: host.id, importedSessionIds: outing.sessionIds });
      continue;
    }

    if (filedToday >= MAX_FILINGS_PER_USER_PER_DAY) {
      outcomes.push({ kind: "skipped", reason: "daily filing cap" });
      continue;
    }

    // 4. A run the driver opened at this track that day with no laps yet claims forward.
    const claimants = known.map((k) => k.claimant).filter((c): c is DraftClaimant => c !== null);
    const claimPlan = planDraftClaims({
      claimants,
      sessions: [{ id: outing.primaryId, instant: outing.start }],
    });
    const claim = claimPlan.claims[0];
    if (claim) {
      const attached = await attachSessionToClaimant({
        userId,
        runId: claim.claimantId,
        importedLapTimeSessionId: outing.primaryId,
        zone,
      });
      if (attached.status === "attached") {
        await linkSessions(userId, claim.claimantId, secondaries);
        const k = known.find((x) => x.id === claim.claimantId);
        if (k) {
          k.span = { start: outing.start, end: outing.end };
          k.claimant = null;
          k.instant = outing.start;
        }
        filedToday += 1;
        await settle(userId);
        outcomes.push({
          kind: "attached",
          runId: claim.claimantId,
          instant: outing.start,
          bestLapSeconds: await bestLapOf(claim.claimantId),
        });
        continue;
      }
      if (attached.status === "already_linked") {
        outcomes.push({ kind: "skipped", reason: "already on a run" });
        continue;
      }
      // Any other status (no laps, no time) falls through to the placeholder path, which will
      // report the same condition through `createBackfilledRuns`' skip reasons.
    }

    // 5. A car: the one the driver named, else one they established. Never a guess.
    const chip =
      outing.sessionIds.map((id) => rowById.get(id)?.chipCode ?? null).find((c) => !!c) ?? null;
    const carId =
      ctx.carId ??
      resolveSweepCar({
        instant: outing.start,
        dayRunsAtTrack: known.map((k) => ({ carId: k.carId, instant: k.instant })),
        chipCarId: chip ? (chipCars[chip] ?? null) : null,
        userCarIds,
      })?.carId ??
      null;
    if (!carId) {
      outcomes.push({ kind: "loose", importedSessionId: outing.primaryId, instant: outing.start });
      continue;
    }

    const created = await createBackfilledRuns({
      userId,
      context: {
        kind: "track",
        trackId: track.id,
        carId,
        zone,
        sessionType: primaryRow.sourceKind === "race" ? "RACE_MEETING" : "TESTING",
        meetingSessionType: primaryRow.sourceKind === "race" ? "RACE" : null,
      },
      importedLapTimeSessionIds: [outing.primaryId],
      deviceTimeZone: zone,
      filedBySweep: true,
    });
    const made = created.created[0];
    if (!made) {
      const reason = created.skipped[0]?.reason ?? "not created";
      outcomes.push({ kind: "skipped", reason: `placeholder: ${reason}` });
      continue;
    }
    await linkSessions(userId, made.runId, secondaries);
    known.push({
      id: made.runId,
      carId,
      instant: outing.start,
      span: { start: outing.start, end: outing.end },
      claimant: null,
    });
    filedToday += 1;
    await settle(userId);
    outcomes.push({
      kind: "placeholder",
      runId: made.runId,
      instant: outing.start,
      bestLapSeconds: await bestLapOf(made.runId),
    });
  }

  return outcomes;
}

async function isListener(userId: string): Promise<boolean> {
  const allow = sweepListenerAllowlist();
  if (allow === null) return true;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return isSweepListenerEmail(u?.email, allow);
}

/** The other sources of an outing ride along on its run; the run's laps stay the primary's. */
async function linkSessions(userId: string, runId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.importedLapTimeSession.updateMany({
    where: { id: { in: [...ids] }, userId, linkedRunId: null },
    data: { linkedRunId: runId },
  });
}

async function forEachPooled<T>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function settle(userId: string): Promise<void> {
  await applyRunWindow(userId);
  revalidateAfterRunMutation(userId);
}

async function bestLapOf(runId: string): Promise<number | null> {
  const r = await prisma.run.findUnique({ where: { id: runId }, select: { bestLapSeconds: true } });
  return r?.bestLapSeconds ?? null;
}
