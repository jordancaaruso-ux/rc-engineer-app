import "server-only";

import { prisma } from "@/lib/prisma";
import {
  fetchPracticeLocation,
  fetchPracticeLocationActivities,
  fetchPracticeSessionsForChipAtLocation,
  practiceTimestampToIso,
} from "@/lib/speedhive/speedhivePracticeClient";
import { buildSpeedhivePracticeActivityUrl } from "@/lib/speedhive/speedhivePracticeUrl";
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

const MAX_PRACTICE_ACTIVITIES = 40;
const MAX_CHIP_SESSIONS = 30;

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
  const discovered = new Map<number, SpeedhiveDiscoveredSession>();

  try {
    if (chipCodes.length > 0) {
      for (const chipCode of chipCodes) {
        const sessions = (await fetchPracticeSessionsForChipAtLocation(locationId, chipCode)).slice(
          0,
          MAX_CHIP_SESSIONS
        );
        for (const sess of sessions) {
          const activityId = sess.id;
          if (!activityId || discovered.has(activityId)) continue;
          const completedIso =
            practiceTimestampToIso(sess.endtimeutc) ??
            practiceTimestampToIso(sess.starttimeutc);
          discovered.set(activityId, {
            sessionUrl: buildSpeedhivePracticeActivityUrl(locationId, activityId),
            sessionId: String(activityId),
            sessionCompletedAtIso: completedIso,
            sourceKind: "practice",
            label: [locationLabel, `Transponder ${chipCode}`].filter(Boolean).join(" · "),
            alreadyImported: false,
            linkedRunId: null,
            timingSource: "speedhive",
          });
        }
      }
    }

    if (driverNorm && discovered.size === 0) {
      const activities = await fetchPracticeLocationActivities(locationId, {
        count: MAX_PRACTICE_ACTIVITIES,
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
        discovered.set(act.id, {
          sessionUrl: buildSpeedhivePracticeActivityUrl(locationId, act.id),
          sessionId: String(act.id),
          sessionCompletedAtIso: completedIso,
          sourceKind: "practice",
          label: [locationLabel, label, act.name].filter(Boolean).join(" · "),
          alreadyImported: false,
          linkedRunId: null,
          timingSource: "speedhive",
        });
      }
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

  const list = [...discovered.values()];
  const urls = list.map((d) => d.sessionUrl);
  const imports =
    urls.length > 0
      ? await prisma.importedLapTimeSession.findMany({
          where: { userId: input.userId, sourceUrl: { in: urls } },
          select: { sourceUrl: true, linkedRunId: true },
        })
      : [];
  const importByUrl = new Map(imports.map((i) => [i.sourceUrl, i.linkedRunId]));

  for (const d of list) {
    if (importByUrl.has(d.sessionUrl)) {
      d.alreadyImported = true;
      d.linkedRunId = importByUrl.get(d.sessionUrl) ?? null;
    }
  }

  const sorted = [...list].sort(
    (a, b) => sessionSortKey(b.sessionCompletedAtIso) - sessionSortKey(a.sessionCompletedAtIso)
  );
  const unimported = sorted.filter((d) => !d.alreadyImported);

  return {
    candidates: sorted,
    unimportedCandidates: unimported,
    mostRecentSession: unimported[0] ?? sorted[0] ?? null,
    practiceLocationId: locationId,
    hint:
      unimported.length > 0
        ? null
        : sorted.length > 0
          ? "All matching Speedhive practice sessions are already imported."
          : chipCodes.length > 0
            ? "No practice sessions matched your transponder at this track."
            : "No practice sessions matched your name at this track.",
  };
}
