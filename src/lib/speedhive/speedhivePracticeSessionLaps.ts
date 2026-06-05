import "server-only";

import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { fetchPracticeTrainingSessions } from "@/lib/speedhive/speedhivePracticeClient";
import {
  parseSpeedhivePracticeActivityRef,
  buildSpeedhivePracticeActivityUrl,
} from "@/lib/speedhive/speedhivePracticeUrl";
import { isSpeedhiveOrApiUrl } from "@/lib/speedhive/speedhiveUrl";

const PARSER_ID = "speedhive_practice_v1";

export function isSpeedhivePracticeActivityUrl(url: string): boolean {
  return parseSpeedhivePracticeActivityRef(url) != null;
}

function parseLapDurationSeconds(duration: string | undefined): number | null {
  const t = duration?.trim();
  if (!t || t === "-") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function importSpeedhivePracticeActivity(
  urlOrRef: string | { locationId: number; activityId: number }
): Promise<LapUrlParseResult> {
  const ref =
    typeof urlOrRef === "string"
      ? parseSpeedhivePracticeActivityRef(urlOrRef)
      : {
          locationId: urlOrRef.locationId,
          activityId: urlOrRef.activityId,
          sessionUrl: buildSpeedhivePracticeActivityUrl(
            urlOrRef.locationId,
            urlOrRef.activityId
          ),
        };

  if (!ref) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      message:
        "Unsupported Speedhive practice URL — use a link from your track practice page.",
      errorCode: "unsupported_url",
    };
  }

  try {
    const trainingSessions = await fetchPracticeTrainingSessions(ref.activityId);
    if (trainingSessions.length === 0) {
      return {
        parserId: PARSER_ID,
        laps: [],
        candidates: [],
        message: "No lap times found for this Speedhive practice activity.",
        errorCode: "empty_session",
      };
    }

    const blocks =
      ref.trainingSessionId != null
        ? trainingSessions.filter((b) => b.id === ref.trainingSessionId)
        : trainingSessions;

    const sessionDrivers: LapUrlSessionDriver[] = [];
    for (const block of blocks) {
      const lapsRaw = block.laps ?? [];
      const laps: number[] = [];
      for (const lap of lapsRaw) {
        const sec = parseLapDurationSeconds(lap.duration);
        if (sec != null && sec > 0) laps.push(sec);
      }
      if (laps.length === 0) continue;

      const driverId = `sh-practice-${ref.activityId}-${block.id}`;
      const when = block.dateTimeStart?.trim();
      const whenLabel =
        when && !Number.isNaN(new Date(when).getTime())
          ? new Date(when).toLocaleString()
          : `Run ${block.id}`;
      sessionDrivers.push({
        id: driverId,
        driverId,
        driverName: whenLabel,
        normalizedName: whenLabel.toLowerCase(),
        laps,
        lapCount: laps.length,
      });
    }

    if (sessionDrivers.length === 0) {
      return {
        parserId: PARSER_ID,
        laps: [],
        candidates: [],
        message: ref.trainingSessionId
          ? "No lap times found for this practice run."
          : "No lap times found for this Speedhive practice activity.",
        errorCode: "empty_session",
      };
    }

    const primary =
      ref.trainingSessionId != null
        ? sessionDrivers[0]!
        : sessionDrivers.reduce((best, cur) =>
            cur.laps.length > best.laps.length ? cur : best
          );
    const startIso = blocks[0]?.dateTimeStart?.trim();
    const sessionCompletedAtIso =
      startIso && !Number.isNaN(new Date(startIso).getTime())
        ? new Date(startIso).toISOString()
        : null;

    return {
      parserId: PARSER_ID,
      laps: primary.laps,
      sessionDrivers,
      sessionHint: { name: primary.driverName },
      sessionCompletedAtIso,
      message: null,
    };
  } catch (e) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      message: e instanceof Error ? e.message : "Speedhive practice import failed",
      errorCode: "fetch_failed",
    };
  }
}

export function isSpeedhivePracticeImportUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || !isSpeedhiveOrApiUrl(trimmed)) return false;
  return isSpeedhivePracticeActivityUrl(trimmed);
}
