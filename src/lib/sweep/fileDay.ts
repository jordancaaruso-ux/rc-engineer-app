import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getLiveRcDriverNameSetting,
  getSpeedhiveTransponderCarsSetting,
  getSpeedhiveTransponderMovedSetting,
  setSpeedhiveTransponderCarsSetting,
  setSpeedhiveTransponderMovedSetting,
} from "@/lib/appSettings";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import {
  chipToPairWithNamedCar,
  formatTransponderCarsSetting,
  parseTransponderCarsSetting,
  type TransponderCarMap,
} from "@/lib/speedhive/transponderCars";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";
import {
  chipOnHandLoggedRun,
  formatChipMovedSetting,
  parseChipMovedSetting,
  type ChipMovedState,
} from "@/lib/speedhive/transponderMoved";
import { importOneTimingUrl } from "@/lib/lapImport/service";
import { todayBoundsInTimeZone } from "@/lib/eventActive";
import { createBackfilledRuns } from "@/lib/runs/createBackfilledRuns";
import { groupOutings, type Outing, type OutingSession } from "@/lib/runs/groupOutings";
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
import type { PendingOuting } from "@/lib/sweep/pendingOutings";
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
  /**
   * When the timing site's own list says the session ran (LiveRC's race list: "Sep 12, 2026 at
   * 11:38am"), in the parser's stored convention. A LiveRC race result page prints only the
   * MEETING's date, so without this every race imported with no time, could not be placed on a
   * day, and sat loose under "which car?" for a driver with one car (SA State Titles, 2026-09-16).
   */
  listedAtIso?: string | null;
};

/** The list's time, when the imported page gave none — or only a bare date (midnight). */
function listedTimeToStamp(pageTime: Date | null, listedAtIso: string | null | undefined): Date | null {
  const listed = listedAtIso?.trim() ? new Date(listedAtIso) : null;
  if (!listed || Number.isNaN(listed.getTime())) return null;
  if (!pageTime) return listed;
  const dateOnly =
    pageTime.getUTCHours() === 0 &&
    pageTime.getUTCMinutes() === 0 &&
    pageTime.getUTCSeconds() === 0 &&
    pageTime.getUTCMilliseconds() === 0;
  return dateOnly && pageTime.getTime() !== listed.getTime() ? listed : null;
}

export type FileOutcome =
  /** Laps put on a run the driver had opened without any — a draft, or a run saved lap-less. */
  | { kind: "attached"; runId: string; instant: Date; bestLapSeconds: number | null }
  /** A run made from an outing the driver TICKED in the sheet. Never from the app's own initiative. */
  | { kind: "logged"; runId: string; instant: Date; bestLapSeconds: number | null }
  /** The outing overlapped a run the driver already had that day: its sessions joined that run. */
  | { kind: "joined"; runId: string; importedSessionIds: string[] }
  /** Imported and kept, on no run: the sheet offers it. */
  | { kind: "loose"; importedSessionId: string; instant: Date | null }
  | { kind: "skipped"; reason: string };

/** An imported session, ready to file. */
export type FilingRow = ImportedRowForOuting & {
  chipCode: string | null;
  sourceKind: "practice" | "race";
};

/**
 * Who is filing. `evening`: the 8 pm pass, acting for a driver who is not there, so the listener
 * allowlist applies. `driver`: the driver pressed "Import your last runs" and is acting for themselves.
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
  filedBySweepAt: true,
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
  /** The driver made this run and picked its car — not one the app made from a tick. */
  byHand: boolean;
};

/**
 * One driver's day at one track, read and placed — never filed (founder ruling 2026-09-18:
 * "it shouldn't auto import anything"). On OUTINGS rather than raw sessions (2026-09-15):
 *
 *   1. import every session the gatherers found, from every source, before placing anything;
 *   2. group them into outings — windows that overlap are one time on track, and the official
 *      record leads (`groupOutings.ts`);
 *   3. an outing that overlaps a run the driver already has that day joins it as a linked source —
 *      it is their run, the timing sheet only completes it;
 *   4. else an open draft / lap-less run of theirs at that track that day claims it forward — the
 *      driver opened that run, the sheet closes it;
 *   5. else it stays LOOSE: imported and kept, on no run, until the driver ticks it in the sheet
 *      (`logChosenOutingsForUser`) or unticks it. Nothing lands in the log that was not ticked.
 *
 * Every step is idempotent: a session already on a run is skipped, claims happen inside
 * transactions, and the import row is one-per-URL. Called by the 8 pm pass and by "Import your
 * last runs".
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
  // listener list. A driver pressing "Import your last runs" is acting for themselves.
  if ((input.trigger ?? "evening") === "evening" && !(await isListener(input.userId))) {
    return [{ kind: "skipped", reason: "not a listener" }];
  }

  const rows = await importCandidates(input.userId, input.track, input.candidates, now, outcomes);
  if (rows.length === 0) return outcomes;
  return placeRows({ userId: input.userId, track: input.track, rows, outcomes });
}

/** Step 1: the whole day in hand before anything is placed. */
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
  // Each site is asked for the name it knows the driver by: a LiveRC page gets every LiveRC name
  // (one per line — the matcher tries each), MYLAPS gets its own list below.
  const liveRcNames = liveName?.trim() ?? "";
  const speedhiveFirst = speedhiveNames[0]?.trim() ?? "";
  const sharedContext = {
    ...(speedhiveNames.length > 0 ? { speedhiveDriverNames: speedhiveNames } : {}),
    ...(transponders.length > 0 ? { speedhiveTransponderNumbers: transponders } : {}),
  };
  const contextFor = (source: GatheredCandidate["source"]) => {
    const driverName = source === "liverc" ? liveRcNames || speedhiveFirst : speedhiveFirst;
    return { ...(driverName ? { driverName } : {}), ...sharedContext };
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
      const imported = await importOneTimingUrl(userId, c.sessionUrl, contextFor(c.source));
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
          sweepChipCode: true,
          trackId: true,
          detectionPromptDismissedAt: true,
        },
      });
      if (!row) {
        outcomes.push({ kind: "skipped", reason: "import row missing" });
        return;
      }
      const listedTime = listedTimeToStamp(row.sessionCompletedAt, c.listedAtIso);
      const chip = c.chipCode ? normalizeSpeedhiveTransponderNumber(c.chipCode) : null;
      const chipChanged = Boolean(chip) && row.sweepChipCode !== chip;
      if (!row.sweepFiledAt || row.trackId !== track.id || listedTime || chipChanged) {
        await prisma.importedLapTimeSession.update({
          where: { id: row.id },
          data: {
            sweepFiledAt: row.sweepFiledAt ?? now,
            trackId: track.id,
            ...(listedTime ? { sessionCompletedAt: listedTime } : {}),
            // Kept on the row: a loose session re-read for the sheet still knows its chip.
            ...(chipChanged ? { sweepChipCode: chip } : {}),
          },
        });
      }
      if (row.linkedRunId) {
        outcomes.push({ kind: "skipped", reason: "already on a run" });
        return;
      }
      // Unticked in the sheet before: stays out, and a second read does not offer it again.
      if (row.detectionPromptDismissedAt) {
        outcomes.push({ kind: "skipped", reason: "declined" });
        return;
      }
      rows.push({
        id: row.id,
        sourceUrl: row.sourceUrl,
        parserId: row.parserId,
        parsedPayload: row.parsedPayload,
        sessionCompletedAt: listedTime ?? row.sessionCompletedAt,
        chipCode: chip ?? row.sweepChipCode ?? null,
        sourceKind: c.sourceKind,
      });
    } catch (err) {
      outcomes.push({ kind: "skipped", reason: `import: ${err instanceof Error ? err.message : "failed"}` });
    }
  });
  return rows;
}

/** Steps 2–5: outings, then join / claim / loose, one outing at a time. */
async function placeRows(ctx: {
  userId: string;
  track: FilingTrack;
  rows: FilingRow[];
  outcomes: FileOutcome[];
}): Promise<FileOutcome[]> {
  const { userId, track, rows, outcomes } = ctx;
  const zone = track.timeZone;

  const { outings, rowById } = outingsFromRows(rows, zone, outcomes);
  if (outings.length === 0) return outcomes;

  const earliest = outings.reduce((a, b) => (a.start < b.start ? a : b)).start;
  const day = todayBoundsInTimeZone(zone, earliest);
  const known = await loadKnownRuns(userId, track.id, day, zone);
  /** Chips found on runs the driver logged by hand, with that run's car — what they teach, after. */
  const handLoggedChips: { chip: string; carId: string }[] = [];

  for (const outing of outings) {
    const secondaries = outing.sessionIds.filter((id) => id !== outing.primaryId);
    const chip = chipOf(outing, rowById);

    // 3. Same time on track as a run the driver already has: join it, never open a second one.
    const host = known.find((k) => k.span && spansOverlap(k.span, outing));
    if (host) {
      await linkSessions(userId, host.id, outing.sessionIds);
      host.span = {
        start: host.span!.start < outing.start ? host.span!.start : outing.start,
        end: host.span!.end > outing.end ? host.span!.end : outing.end,
      };
      if (chip && host.byHand && host.carId) handLoggedChips.push({ chip, carId: host.carId });
      outcomes.push({ kind: "joined", runId: host.id, importedSessionIds: outing.sessionIds });
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
          if (chip && k.byHand && k.carId) handLoggedChips.push({ chip, carId: k.carId });
        }
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
      // Any other status (no laps, no time): the outing stays loose and the sheet offers it.
    }

    // 5. Loose. The sheet lists it; a tick makes it a run, an untick puts it away.
    outcomes.push({ kind: "loose", importedSessionId: outing.primaryId, instant: outing.start });
  }

  const chipCars = parseTransponderCarsSetting(await getSpeedhiveTransponderCarsSetting(userId).catch(() => null));
  const cars = await prisma.car.findMany({ where: { userId }, select: { id: true } });
  await learnChipPairings({
    userId,
    namedCarId: null,
    namedCarChips: [],
    handLoggedChips,
    chipCars,
    userCarIds: cars.map((c) => c.id),
  });

  return outcomes;
}

/**
 * The car each pending outing would be logged under, from facts the driver established
 * (`resolveSweepCar`: the chip's bound car, an earlier run that day, one car all day, the only
 * car). Null where the app cannot tell — the sheet then asks once, and the answer covers only
 * those. Read alongside the pending list so the sheet can show the car on each row.
 */
export async function carsForPendingOutings(input: {
  userId: string;
  track: FilingTrack;
  day: { start: Date; end: Date };
  pending: readonly PendingOuting[];
  rowById: ReadonlyMap<string, FilingRow>;
}): Promise<Map<string, { carId: string; carName: string } | null>> {
  const { userId, track, day, pending } = input;
  const out = new Map<string, { carId: string; carName: string } | null>();
  if (pending.length === 0) return out;
  const [known, cars, carsRaw] = await Promise.all([
    loadKnownRuns(userId, track.id, day, track.timeZone),
    prisma.car.findMany({ where: { userId }, select: { id: true, name: true } }),
    getSpeedhiveTransponderCarsSetting(userId).catch(() => null),
  ]);
  const chipCars = parseTransponderCarsSetting(carsRaw);
  const nameById = new Map(cars.map((c) => [c.id, c.name]));
  const userCarIds = cars.map((c) => c.id);
  for (const o of pending) {
    const chip = chipOf(o, input.rowById);
    const resolved = resolveSweepCar({
      instant: o.start,
      dayRunsAtTrack: known.map((k) => ({ carId: k.carId, instant: k.instant })),
      chipCarId: chip ? (chipCars[chip] ?? null) : null,
      userCarIds,
    });
    out.set(o.id, resolved ? { carId: resolved.carId, carName: nameById.get(resolved.carId) ?? "" } : null);
  }
  return out;
}

/**
 * The sheet answered: the outings the driver TICKED become runs, the ones they unticked are put
 * away (`detectionPromptDismissedAt`) so no read offers them again. `carId` is the car the driver
 * named for the outings the app could not place; an outing with a car of its own keeps it.
 * Nothing is read from the timing sites.
 */
export async function logChosenOutingsForUser(input: {
  userId: string;
  track: FilingTrack;
  day: { start: Date; end: Date };
  keep: readonly PendingOuting[];
  decline: readonly PendingOuting[];
  rowById: ReadonlyMap<string, FilingRow>;
  carId: string | null;
  now?: Date;
}): Promise<FileOutcome[]> {
  const { userId, track, day, rowById } = input;
  const zone = track.timeZone;
  const now = input.now ?? new Date();
  const outcomes: FileOutcome[] = [];

  const declinedIds = input.decline.flatMap((o) => o.sessionIds);
  if (declinedIds.length > 0) {
    await prisma.importedLapTimeSession.updateMany({
      where: { id: { in: declinedIds }, userId, linkedRunId: null },
      data: { detectionPromptDismissedAt: now },
    });
  }
  if (input.keep.length === 0) return outcomes;

  const [known, cars, filedCount, carsRaw] = await Promise.all([
    loadKnownRuns(userId, track.id, day, zone),
    prisma.car.findMany({ where: { userId }, select: { id: true } }),
    // Runs the app made for that DAY, by when they were on track — the cap is per day raced.
    prisma.run.count({
      where: {
        userId,
        sortAt: { gte: day.start, lt: day.end },
        OR: [{ filedBySweepAt: { not: null } }, { lapsAttachedBySweepAt: { not: null } }],
      },
    }),
    getSpeedhiveTransponderCarsSetting(userId).catch(() => null),
  ]);
  const userCarIds = cars.map((c) => c.id);
  const chipCars = parseTransponderCarsSetting(carsRaw);
  let filedToday = filedCount;
  /** Chips of the outings the driver's named car just logged — see the pairing after the loop. */
  const namedCarChips: (string | null)[] = [];

  for (const outing of input.keep) {
    const primaryRow = rowById.get(outing.id);
    if (!primaryRow) {
      outcomes.push({ kind: "skipped", reason: "not pending" });
      continue;
    }
    const secondaries = outing.sessionIds.filter((id) => id !== outing.id);
    const chip = chipOf(outing, rowById);

    // A run the driver logged since the list was read covers this time: join it, never double up.
    const host = known.find((k) => k.span && spansOverlap(k.span, outing));
    if (host) {
      await linkSessions(userId, host.id, outing.sessionIds);
      outcomes.push({ kind: "joined", runId: host.id, importedSessionIds: outing.sessionIds });
      continue;
    }

    if (filedToday >= MAX_FILINGS_PER_USER_PER_DAY) {
      outcomes.push({ kind: "skipped", reason: "daily filing cap" });
      continue;
    }

    const resolved = resolveSweepCar({
      instant: outing.start,
      dayRunsAtTrack: known.map((k) => ({ carId: k.carId, instant: k.instant })),
      chipCarId: chip ? (chipCars[chip] ?? null) : null,
      userCarIds,
    });
    const carId = resolved?.carId ?? input.carId;
    if (!carId || !userCarIds.includes(carId)) {
      outcomes.push({ kind: "loose", importedSessionId: outing.id, instant: outing.start });
      continue;
    }
    const named = !resolved;

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
      importedLapTimeSessionIds: [outing.id],
      deviceTimeZone: zone,
      filedBySweep: true,
    });
    const made = created.created[0];
    if (!made) {
      const reason = created.skipped[0]?.reason ?? "not created";
      outcomes.push({ kind: "skipped", reason: `log: ${reason}` });
      continue;
    }
    await linkSessions(userId, made.runId, secondaries);
    if (named) namedCarChips.push(chip);
    known.push({
      id: made.runId,
      carId,
      instant: outing.start,
      span: { start: outing.start, end: outing.end },
      claimant: null,
      byHand: false,
    });
    filedToday += 1;
    await settle(userId);
    outcomes.push({
      kind: "logged",
      runId: made.runId,
      instant: outing.start,
      bestLapSeconds: await bestLapOf(made.runId),
    });
  }

  await learnChipPairings({
    userId,
    namedCarId: input.carId,
    namedCarChips,
    handLoggedChips: [],
    chipCars,
    userCarIds,
  });
  return outcomes;
}

/** Windows on track, then outings; a row with no time on the page is loose and reported so. */
export function outingsFromRows(
  rows: readonly FilingRow[],
  zone: string,
  outcomes?: FileOutcome[],
): { outings: Outing[]; rowById: Map<string, FilingRow> } {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const sessions: OutingSession[] = [];
  for (const row of rows) {
    const s = outingSessionFromImportedRow(row, zone);
    if (!s) {
      // No time on the page: nothing to place it by.
      outcomes?.push({ kind: "loose", importedSessionId: row.id, instant: null });
      continue;
    }
    sessions.push(s);
  }
  return { outings: sessions.length > 0 ? groupOutings(sessions) : [], rowById };
}

function chipOf(outing: { sessionIds: readonly string[] }, rowById: ReadonlyMap<string, FilingRow>): string | null {
  return outing.sessionIds.map((id) => rowById.get(id)?.chipCode ?? null).find((c) => !!c) ?? null;
}

/**
 * The day as it stands: every run at this track that day, whatever its state. "That day"
 * includes a run logged later about it — Saturday's heat entered on Sunday from the MyRCM PDF
 * was written, and sorts, on Sunday; only its session time says Saturday. Missing it here filed
 * the same heat again from Speedhive as a second run.
 */
async function loadKnownRuns(
  userId: string,
  trackId: string,
  day: { start: Date; end: Date },
  zone: string,
): Promise<KnownRun[]> {
  const dayRuns = await prisma.run.findMany({
    where: {
      userId,
      trackId,
      OR: [
        { createdAt: { gte: day.start, lt: day.end } },
        { sortAt: { gte: day.start, lt: day.end } },
        { sessionCompletedAt: { gte: day.start, lt: day.end } },
      ],
    },
    select: DAY_RUN_SELECT,
  });
  return dayRuns.map((r) => {
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
      byHand: r.filedBySweepAt === null,
    };
  });
}

/**
 * What the driver's own choices said about their chips (founder call 2026-09-17), written once
 * after a filing. "Which car?" answered for runs found by one chip pairs that chip with that car.
 * A chip on a run they logged by hand pairs an unpaired chip, or — paired with a different car —
 * leaves one "has it moved?" question for the next "Import your last runs". A chip seen in two
 * cars in the same filing teaches nothing. Never fails the filing.
 */
async function learnChipPairings(input: {
  userId: string;
  namedCarId: string | null;
  namedCarChips: readonly (string | null)[];
  handLoggedChips: readonly { chip: string; carId: string }[];
  chipCars: TransponderCarMap;
  userCarIds: readonly string[];
}): Promise<void> {
  const { userId, userCarIds } = input;
  const map: TransponderCarMap = { ...input.chipCars };
  let mapChanged = false;

  if (input.namedCarId) {
    const pair = chipToPairWithNamedCar({ chips: input.namedCarChips, map, userCarIds });
    if (pair) {
      map[pair] = input.namedCarId;
      mapChanged = true;
    }
  }

  const carsByChip = new Map<string, Set<string>>();
  for (const h of input.handLoggedChips) {
    const set = carsByChip.get(h.chip) ?? new Set<string>();
    set.add(h.carId);
    carsByChip.set(h.chip, set);
  }

  try {
    let moved: ChipMovedState | null = null;
    for (const [chip, carIds] of carsByChip) {
      if (carIds.size !== 1) continue;
      const runCarId = [...carIds][0]!;
      moved ??= parseChipMovedSetting(await getSpeedhiveTransponderMovedSetting(userId));
      const verdict = chipOnHandLoggedRun({ chip, runCarId, map, userCarIds, declined: moved.declined });
      if (verdict === "pair") {
        map[chip] = runCarId;
        mapChanged = true;
      } else if (verdict === "ask") {
        moved = { ...moved, pending: { chip, carId: runCarId } };
        await setSpeedhiveTransponderMovedSetting(userId, formatChipMovedSetting(moved));
      }
    }
    if (mapChanged) {
      await setSpeedhiveTransponderCarsSetting(userId, formatTransponderCarsSetting(map));
    }
  } catch {
    // A pairing not learned is asked again next time; the runs themselves are already filed.
  }
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
