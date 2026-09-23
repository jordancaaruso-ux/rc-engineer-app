import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { instantToWallClockAsUtc } from "@/lib/eventActive";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";
import { primaryNormsFromImportedLapSets } from "@/lib/lapImport/importedTimingFieldStatsForEngineer";
import { trackClockTime } from "@/lib/lapImport/trackClock";
import { normalizeLapTimes } from "@/lib/runLaps";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import type { LapsDriver, LapsSession } from "@/lib/engineer/lapsBlock";

/**
 * The server half of lapsBlock.ts: the timed sessions behind a driver's runs, every entrant's
 * laps included, from the sessions the app already imported (`ImportedLapTimeSession.parsedPayload`
 * keeps the whole sheet — `sessionDrivers[]` — for a race result; a practice page is one driver).
 * Nothing is fetched here: a session that was never imported is not on the wire, and the block
 * says what it holds.
 *
 * Time is the TRACK's clock (lapImport/trackClock.ts): LiveRC and MyRCM stamps are stored as the
 * track's wall clock written as UTC, Speedhive's practice loop as a real instant with an offset,
 * and a LiveRC race result often carries no stamp at all — that one takes its linked run's time as
 * the app shows it (`resolveRunDisplayInstant`), in the same zone as every other clock in the
 * driver's block. Reading a LiveRC stamp in a zone printed a 15:53 Friday session as 01:23
 * Saturday (2026-09-22); and the first fallback read the run's `sortAt` — when the driver STARTED
 * logging, 30 to 95 minutes before the heat — so every stamp-less heat of the founder's SA
 * Saturday printed early and the day block beside it disagreed (2026-09-23).
 *
 * "You" on a sheet is found the way the race-field view finds it — the run's own primary lap-set
 * name, the driver's saved LiveRC name, the import's own server match (`sessionHint.name`), then a
 * lap-for-lap match against the run's laps. No first-driver guess here: guessing marks someone
 * else's laps "(you)", and the block would rather say nobody matched.
 */

export type LapsRunInput = {
  id: string;
  createdAt: Date;
  sortAt: Date | null;
  /** The three stamps `resolveRunDisplayInstant` weighs — required so every caller selects them. */
  sessionCompletedAt: Date | null;
  loggingCompletedAt: Date | null;
  unconfirmedAt: Date | null;
  lapTimes: unknown;
  importedLapTimeSessionId: string | null;
  importedLapSets: Array<{ driverName: string; isPrimaryUser: boolean }>;
};

type SessionRow = {
  id: string;
  sourceUrl: string;
  parserId: string;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  linkedRunId: string | null;
  trackId: string | null;
  eventDetectionSessionLabel: string | null;
  parsedPayload: unknown;
};

type ParsedDriver = { driverId?: string; driverName?: string; normalizedName?: string; laps?: unknown };

function parsedOf(row: SessionRow): {
  laps: number[];
  drivers: Array<{ id: string; name: string; norm: string; laps: number[] }>;
  className: string | null;
  hintName: string | null;
  utcOffsetMinutes: number | null;
} {
  const p = (row.parsedPayload ?? {}) as {
    laps?: unknown;
    sessionDrivers?: unknown;
    sessionHint?: { name?: unknown; className?: unknown } | null;
    sessionUtcOffsetMinutes?: unknown;
  };
  const drivers = (Array.isArray(p.sessionDrivers) ? (p.sessionDrivers as ParsedDriver[]) : [])
    .filter((d) => typeof d.driverName === "string")
    .map((d, i) => ({
      id: typeof d.driverId === "string" ? d.driverId : `d${i}`,
      name: d.driverName as string,
      norm: typeof d.normalizedName === "string" ? d.normalizedName : normalizeLiveRcDriverNameForMatch(d.driverName as string),
      laps: normalizeLapTimes(d.laps),
    }));
  return {
    laps: normalizeLapTimes(p.laps),
    drivers,
    className: typeof p.sessionHint?.className === "string" ? p.sessionHint.className : null,
    hintName: typeof p.sessionHint?.name === "string" ? p.sessionHint.name : null,
    utcOffsetMinutes: typeof p.sessionUtcOffsetMinutes === "number" ? p.sessionUtcOffsetMinutes : null,
  };
}

function lapsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.0005) return false;
  return true;
}

/**
 * A run's time as the app shows it, as the wall clock of `zone` written as UTC — the same shape
 * trackClockTime gives, and the same moment the day block prints for that run.
 */
function runWallClock(run: LapsRunInput, zone: string | null): Date {
  const instant = resolveRunDisplayInstant(run);
  if (!zone) return instant;
  try {
    return instantToWallClockAsUtc(instant, zone);
  } catch {
    return instant;
  }
}

/** "Race 15: ISTC Modified (ISTC Modified A3-Main)" → "ISTC Modified A3-Main"; nothing saved → "Race" / "Practice". */
function sessionLabel(row: SessionRow, isRace: boolean): string {
  const raw = row.eventDetectionSessionLabel?.trim();
  if (raw) {
    const inParens = raw.match(/\(([^()]+)\)\s*$/)?.[1]?.trim();
    return inParens || raw;
  }
  return isRace ? "Race" : "Practice";
}

/**
 * Which sessions: those linked to the given runs, plus any of the driver's own sessions whose
 * time on track falls inside the window — the loose practice imports the sweep filed without a
 * run. `keep` decides per session (by its day at the track, or the range's span) whether it belongs.
 */
export async function loadLapsSessions(params: {
  userId: string;
  runs: ReadonlyArray<LapsRunInput>;
  /** UTC bounds of the sessions to consider — a day either side of the anchor, or the range. */
  window: { from: Date; to: Date };
  /** The zone a linked run's clock is read in when the session itself has no stamp. */
  zone: string | null;
  /** True for a session that belongs — by its day at the track, its track, or its linked run. */
  keep: (s: { ymd: string; trackId: string | null; linkedRunId: string | null }) => boolean;
}): Promise<LapsSession[]> {
  const runIds = params.runs.map((r) => r.id);
  const detectedIds = params.runs.map((r) => r.importedLapTimeSessionId).filter((id): id is string => !!id);
  const rows: SessionRow[] = await prisma.importedLapTimeSession.findMany({
    where: {
      userId: params.userId,
      OR: [
        ...(runIds.length ? [{ linkedRunId: { in: runIds } }] : []),
        ...(detectedIds.length ? [{ id: { in: detectedIds } }] : []),
        // Loose sessions on the day — never one the driver deleted. Linked ones can't be deleted.
        { sessionCompletedAt: { gte: params.window.from, lte: params.window.to }, hiddenAt: null },
      ],
    },
    select: {
      id: true,
      sourceUrl: true,
      parserId: true,
      createdAt: true,
      sessionCompletedAt: true,
      linkedRunId: true,
      trackId: true,
      eventDetectionSessionLabel: true,
      parsedPayload: true,
    },
  });
  if (rows.length === 0) return [];

  const runById = new Map(params.runs.map((r) => [r.id, r]));
  const runByDetected = new Map(params.runs.filter((r) => r.importedLapTimeSessionId).map((r) => [r.importedLapTimeSessionId as string, r]));
  const liveName = await getLiveRcDriverNameSetting(params.userId).catch(() => null);
  const savedNorm = liveName?.trim() ? normalizeLiveRcDriverNameForMatch(liveName) : "";

  const out: Array<LapsSession & { at: number; linked: boolean; createdAt: number; signature: string }> = [];
  for (const row of rows) {
    const run = runByDetected.get(row.id) ?? (row.linkedRunId ? runById.get(row.linkedRunId) : undefined);
    const parsed = parsedOf(row);
    // The track's clock, as-if-UTC; a stamp-less session takes its run's clock, or has no day.
    const at =
      trackClockTime({
        iso: row.sessionCompletedAt?.toISOString(),
        sourceUrl: row.sourceUrl,
        parserId: row.parserId,
        utcOffsetMinutes: parsed.utcOffsetMinutes,
        fallbackTimeZone: params.zone,
      }) ?? (run ? runWallClock(run, params.zone) : null);
    if (!at) continue;
    const ymd = at.toISOString().slice(0, 10);
    if (!params.keep({ ymd, trackId: row.trackId, linkedRunId: row.linkedRunId })) continue;

    const isRace = parsed.drivers.length > 1 || /view_race_result/i.test(row.sourceUrl);
    const norms = new Set<string>([
      ...(run ? primaryNormsFromImportedLapSets(run.importedLapSets) : []),
      ...(savedNorm ? [savedNorm] : []),
      ...(parsed.hintName ? [normalizeLiveRcDriverNameForMatch(parsed.hintName)] : []),
    ]);
    const runLaps = run ? normalizeLapTimes(run.lapTimes) : [];

    let drivers: LapsDriver[];
    if (parsed.drivers.length === 0) {
      // A practice page: one driver, the asker, laps at the top level. The page names nobody
      // worth printing — MYLAPS' "name" for a practice session is its date — so the driver is "you".
      if (parsed.laps.length === 0) continue;
      drivers = [{ name: "you", isMe: true, laps: parsed.laps }];
    } else {
      let mine = parsed.drivers.find((d) => norms.has(d.norm) || norms.has(normalizeLiveRcDriverNameForMatch(d.name)));
      if (!mine && runLaps.length > 0) mine = parsed.drivers.find((d) => lapsEqual(d.laps, runLaps));
      if (!mine && parsed.drivers.length === 1) mine = parsed.drivers[0];
      // A practice page of one driver is the asker's own; MYLAPS names that one driver by the
      // session's date ("12/09/2026, 08:58 am"), which the block then printed as a person.
      drivers = parsed.drivers.map((d) => ({
        name: !isRace && parsed.drivers.length === 1 && d === mine ? "you" : d.name,
        isMe: d === mine,
        laps: d.laps,
      }));
    }
    const signatureLaps = (drivers.find((d) => d.isMe) ?? drivers[0]).laps;
    out.push({
      label: sessionLabel(row, isRace),
      className: parsed.className,
      clock: at.toISOString().slice(11, 16),
      dateYmd: ymd,
      drivers,
      linkedRunId: run?.id ?? null,
      at: at.getTime(),
      linked: run != null,
      createdAt: row.createdAt.getTime(),
      signature: `${drivers.length}|${signatureLaps.map((v) => v.toFixed(2)).join(",")}`,
    });
  }

  // The same session imported from two timing sites lands twice, with the two sites' different
  // ideas of its time; the laps are identical, so the laps are the key. The copy linked to a run
  // wins (its clock is the run's), then the first import.
  out.sort((a, b) => Number(b.linked) - Number(a.linked) || a.createdAt - b.createdAt);
  const seen = new Set<string>();
  const unique = out.filter((s) => {
    if (seen.has(s.signature)) return false;
    seen.add(s.signature);
    return true;
  });
  return unique.sort((a, b) => a.at - b.at).map(({ at: _at, linked: _l, createdAt: _c, signature: _s, ...s }) => s);
}
