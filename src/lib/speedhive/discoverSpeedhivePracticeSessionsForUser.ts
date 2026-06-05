import "server-only";

import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
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
  getSpeedhiveDriverNameForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import {
  normalizeSpeedhiveDriverNameForMatch,
  speedhiveDriverNameMatches,
} from "@/lib/speedhive/speedhiveNameNormalize";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";
import { practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";

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
    const when = completedIso ? formatRunCreatedAtDateTime(completedIso) : null;
    out.push({
      sessionUrl: buildSpeedhivePracticeRunUrl(locationId, activityId, block.id),
      sessionId: `${activityId}-${block.id}`,
      sessionCompletedAtIso: completedIso,
      sourceKind: "practice",
      label: [locationLabel, when, `${lapCount} lap${lapCount === 1 ? "" : "s"}`]
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
}> {
  const locationId = practiceLocationIdFromTrackUrl(input.trackSpeedhiveUrl);
  if (!locationId) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      practiceLocationId: null,
      hint: "Invalid Speedhive practice URL — use a link like speedhive.mylaps.com/practice/4591.",
    };
  }

  const [driverName, userTransponders] = await Promise.all([
    getSpeedhiveDriverNameForUser(input.userId),
    getSpeedhiveTransponderNumbersForUser(input.userId),
  ]);
  const driverNorm = driverName ? normalizeSpeedhiveDriverNameForMatch(driverName) : "";
  const chipCodes = chipCodesForUser(userTransponders);

  if (chipCodes.length === 0 && !driverNorm) {
    return {
      candidates: [],
      unimportedCandidates: [],
      mostRecentSession: null,
      practiceLocationId: locationId,
      hint:
        "Set your MYLAPS transponder number in Settings to find practice sessions at this track.",
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

    if (activityIds.size === 0 && driverNorm) {
      const activities = await fetchPracticeLocationActivities(locationId, {
        count: MAX_ACTIVITIES_TO_EXPAND,
        sport: location?.sport ?? "RC",
      });
      for (const act of activities) {
        if (!act.id) continue;
        const label = act.chipLabel?.trim();
        if (!label || !speedhiveDriverNameMatches(label, driverNorm)) continue;
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

  return {
    candidates: capped,
    unimportedCandidates: unimported,
    mostRecentSession: unimported[0] ?? capped[0] ?? null,
    practiceLocationId: locationId,
    hint:
      unimported.length > 0
        ? null
        : capped.length > 0
          ? "All matching Speedhive practice runs are already imported."
          : chipCodes.length > 0
            ? "No practice runs matched your transponder at this track."
            : "No practice runs matched your name at this track.",
  };
}
