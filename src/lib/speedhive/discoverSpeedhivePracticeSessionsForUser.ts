import "server-only";

import { prisma } from "@/lib/prisma";
import {
  fetchPracticeLocation,
  fetchPracticeLocationActivities,
  fetchPracticeSessionsForChipAtLocation,
  fetchPracticeTrainingSessions,
  practiceTimestampToIso,
  type SpeedhivePracticeTrainingSession,
} from "@/lib/speedhive/speedhivePracticeClient";
import {
  buildSpeedhivePracticeRunUrl,
} from "@/lib/speedhive/speedhivePracticeUrl";
import type { SpeedhiveDiscoveredSession } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";
import {
  getSpeedhiveDriverNamesForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { speedhiveDriverNameMatchesAny } from "@/lib/speedhive/speedhiveNameNormalize";
import { normalizeSpeedhiveDriverNamesForMatch } from "@/lib/speedhive/speedhiveDriverNames";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";
import { practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import {
  emptyLapDiscoveryStatus,
  lapDiscoveryStatusMessage,
  type LapDiscoveryStatus,
} from "@/lib/lapWatch/lapDiscoveryStatus";

const MAX_ACTIVITIES_TO_EXPAND = 15;
const MAX_DISCOVERY_RUNS = 10;

function sessionSortKey(iso: string | null): number {
  if (!iso?.trim()) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function chipCodesForUser(transponders: number[]): string[] {
  const codes = new Set<string>();
  for (const n of transponders) {
    const norm = normalizeSpeedhiveTransponderNumber(n);
    if (norm) codes.add(norm);
  }
  return [...codes];
}

function parseLapDurationSeconds(duration: string | undefined): number | null {
  const t = duration?.trim();
  if (!t || t === "-") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function trainingSessionCompletedIso(block: SpeedhivePracticeTrainingSession): string | null {
  const start = block.dateTimeStart?.trim();
  if (start && !Number.isNaN(new Date(start).getTime())) {
    return new Date(start).toISOString();
  }
  const laps = block.laps ?? [];
  const last = laps[laps.length - 1];
  const lastStart = last?.dateTimeStart?.trim();
  if (lastStart && !Number.isNaN(new Date(lastStart).getTime())) {
    return new Date(lastStart).toISOString();
  }
  return null;
}

function countIncludedLaps(block: SpeedhivePracticeTrainingSession): number {
  let n = 0;
  for (const lap of block.laps ?? []) {
    if (parseLapDurationSeconds(lap.duration) != null) n++;
  }
  return n;
}

function bestLapSecondsFromBlock(block: SpeedhivePracticeTrainingSession): number | null {
  let best: number | null = null;
  for (const lap of block.laps ?? []) {
    const sec = parseLapDurationSeconds(lap.duration);
    if (sec != null && (best == null || sec < best)) best = sec;
  }
  return best;
}

async function runsFromActivity(
  locationId: number,
  locationLabel: string,
  activityId: number,
  activityCompletedIso: string | null
): Promise<SpeedhiveDiscoveredSession[]> {
  const trainingSessions = await fetchPracticeTrainingSessions(activityId);
  const out: SpeedhiveDiscoveredSession[] = [];
  for (const block of trainingSessions) {
    const lapCount = countIncludedLaps(block);
    if (lapCount === 0) continue;
    const bestLapSeconds = bestLapSecondsFromBlock(block);
    const completedIso = trainingSessionCompletedIso(block) ?? activityCompletedIso;
    // No formatted time in the label: this runs on the server (UTC) with no viewer
    // timezone, and the picker row already renders `sessionCompletedAtIso` (a true
    // instant from the practice API) in the device zone next to the title.
    out.push({
      sessionUrl: buildSpeedhivePracticeRunUrl(locationId, activityId, block.id),
      sessionId: `${activityId}-${block.id}`,
      sessionCompletedAtIso: completedIso,
      sourceKind: "practice",
      label: [locationLabel, `${lapCount} lap${lapCount === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" · "),
      bestLapSeconds,
      alreadyImported: false,
      linkedRunId: null,
      timingSource: "speedhive",
    });
  }
  return out;
}

export async function discoverSpeedhivePracticeSessionsForUser(input: {
  userId: string;
  trackSpeedhiveUrl: string;
}): Promise<{
  candidates: SpeedhiveDiscoveredSession[];
  unimportedCandidates: SpeedhiveDiscoveredSession[];
  mostRecentSession: SpeedhiveDiscoveredSession | null;
  practiceLocationId: number | null;
  hint: string | null;
  status: LapDiscoveryStatus | null;
}> {
  const locationId = practiceLocationIdFromTrackUrl(input.trackSpeedhiveUrl);
  if (!locationId) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      practiceLocationId: null,
      hint: "Invalid Speedhive practice URL — use a link like speedhive.mylaps.com/practice/4591.",
      status: emptyLapDiscoveryStatus("invalid_url", "speedhive"),
    };
  }

  const [driverNames, userTransponders] = await Promise.all([
    getSpeedhiveDriverNamesForUser(input.userId),
    getSpeedhiveTransponderNumbersForUser(input.userId),
  ]);
  const driverNorms = normalizeSpeedhiveDriverNamesForMatch(driverNames);
  const chipCodes = chipCodesForUser(userTransponders);

  if (chipCodes.length === 0 && driverNorms.length === 0) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      practiceLocationId: locationId,
      hint:
        "Set your MYLAPS transponder number in Settings to find practice sessions at this track.",
      status: emptyLapDiscoveryStatus("no_identity", "speedhive", {
        timingPages: [
          { source: "speedhive", url: `https://speedhive.mylaps.com/practice/${locationId}` },
        ],
      }),
    };
  }

  const location = await fetchPracticeLocation(locationId);
  const locationLabel = location?.name?.trim() || `Track ${locationId}`;
  const activityIds = new Map<number, string | null>();
  let discovered: SpeedhiveDiscoveredSession[] = [];

  try {
    if (chipCodes.length > 0) {
      for (const chipCode of chipCodes) {
        const sessions = await fetchPracticeSessionsForChipAtLocation(locationId, chipCode);
        const sorted = [...sessions].sort(
          (a, b) =>
            sessionSortKey(practiceTimestampToIso(b.endtimeutc ?? b.starttimeutc)) -
            sessionSortKey(practiceTimestampToIso(a.endtimeutc ?? a.starttimeutc))
        );
        for (const sess of sorted.slice(0, MAX_ACTIVITIES_TO_EXPAND)) {
          if (!sess.id || activityIds.has(sess.id)) continue;
          activityIds.set(
            sess.id,
            practiceTimestampToIso(sess.endtimeutc) ??
              practiceTimestampToIso(sess.starttimeutc)
          );
        }
      }
    }

    if (activityIds.size === 0 && driverNorms.length > 0) {
      const activities = await fetchPracticeLocationActivities(locationId, {
        count: MAX_ACTIVITIES_TO_EXPAND,
        sport: location?.sport ?? "RC",
      });
      for (const act of activities) {
        if (!act.id) continue;
        const label = act.chipLabel?.trim();
        if (!label || !speedhiveDriverNameMatchesAny(label, driverNorms)) continue;
        if (chipCodes.length > 0 && act.chipCode) {
          const codeNorm = normalizeSpeedhiveTransponderNumber(act.chipCode);
          if (codeNorm && !chipCodes.includes(codeNorm)) continue;
        }
        const completedIso = act.endTime
          ? new Date(act.endTime).toISOString()
          : act.startTime
            ? new Date(act.startTime).toISOString()
            : null;
        if (!activityIds.has(act.id)) activityIds.set(act.id, completedIso);
      }
    }

    for (const [activityId, activityIso] of activityIds) {
      const runs = await runsFromActivity(locationId, locationLabel, activityId, activityIso);
      discovered.push(...runs);
    }
  } catch (e) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      practiceLocationId: locationId,
      hint: e instanceof Error ? e.message : "Speedhive practice discovery failed.",
      // The raw error stays in `hint` for logs and admin surfaces; the card reads the state and
      // says "couldn't reach MYLAPS", because `ETIMEDOUT` has never helped anyone at a race track.
      status: emptyLapDiscoveryStatus("unreachable", "speedhive", {
        timingPages: [
          { source: "speedhive", url: `https://speedhive.mylaps.com/practice/${locationId}` },
        ],
      }),
    };
  }

  const sorted = [...discovered].sort(
    (a, b) => sessionSortKey(b.sessionCompletedAtIso) - sessionSortKey(a.sessionCompletedAtIso)
  );
  const capped = sorted.slice(0, MAX_DISCOVERY_RUNS);

  const urls = capped.map((d) => d.sessionUrl);
  const imports =
    urls.length > 0
      ? await prisma.importedLapTimeSession.findMany({
          where: { userId: input.userId, sourceUrl: { in: urls } },
          select: { sourceUrl: true, linkedRunId: true },
        })
      : [];
  const importByUrl = new Map(imports.map((i) => [i.sourceUrl, i.linkedRunId]));

  for (const d of capped) {
    if (importByUrl.has(d.sessionUrl)) {
      d.alreadyImported = true;
      d.linkedRunId = importByUrl.get(d.sessionUrl) ?? null;
    }
  }

  const unimported = capped.filter((d) => !d.alreadyImported);

  const status = await buildPracticeStatus({
    locationId,
    sport: location?.sport ?? "RC",
    matchedCount: capped.length,
    unimportedCount: unimported.length,
    hasChip: chipCodes.length > 0,
  });

  return {
    candidates: capped,
    unimportedCandidates: unimported,
    mostRecentSession: unimported[0] ?? capped[0] ?? null,
    practiceLocationId: locationId,
    hint: status ? lapDiscoveryStatusMessage(status) : null,
    status,
  };
}

/**
 * Which empty state a MYLAPS practice location is in.
 *
 * Speedhive is asked for one transponder's runs and answers with those, so an empty answer on its
 * own can't tell "nobody has uploaded yet" from "your transponder number is wrong" — and those want
 * opposite advice. One extra call for the location's own activity list settles it, and it only ever
 * runs when nothing matched, so the normal path pays nothing for it.
 *
 * The activities are counted, never listed. Unlike LiveRC, there is nothing for a driver to do with
 * a stranger's practice run — you can't claim someone else's transponder.
 */
async function buildPracticeStatus(opts: {
  locationId: number;
  sport: string;
  matchedCount: number;
  unimportedCount: number;
  hasChip: boolean;
}): Promise<LapDiscoveryStatus | null> {
  const timingPages = [
    { source: "speedhive" as const, url: `https://speedhive.mylaps.com/practice/${opts.locationId}` },
  ];
  if (opts.unimportedCount > 0) return null;
  if (opts.matchedCount > 0) {
    return {
      code: "all_imported",
      sources: ["speedhive"],
      postedCount: opts.matchedCount,
      matchedCount: opts.matchedCount,
      timingPages,
      sessionsToday: [],
    };
  }

  let postedCount = 0;
  let postedDayIso: string | null = null;
  try {
    const activities = await fetchPracticeLocationActivities(opts.locationId, {
      count: MAX_ACTIVITIES_TO_EXPAND,
      sport: opts.sport,
    });
    postedCount = activities.length;
    // The newest of them dates the list. Without it the card would say "posted today" about
    // activities that can be weeks old — the same lie LiveRC's practice index tells.
    postedDayIso = newestActivityDayIso(activities);
  } catch {
    // Couldn't ask. Fall through as "nothing posted" rather than inventing a count — the day list
    // is only used to pick between two sentences, so a failure here is not worth its own state.
  }

  return {
    code: postedCount > 0 ? "no_match" : "nothing_posted",
    sources: ["speedhive"],
    postedCount,
    matchedCount: 0,
    timingPages,
    sessionsToday: [],
    postedDayIso,
  };
}

/** The day the most recent activity ran, as YYYY-MM-DD — what dates the count on the card. */
function newestActivityDayIso(
  activities: { startTime?: string | null; endTime?: string | null }[]
): string | null {
  let newest = 0;
  for (const a of activities) {
    const raw = a.endTime?.trim() || a.startTime?.trim();
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest > 0 ? new Date(newest).toISOString().slice(0, 10) : null;
}
