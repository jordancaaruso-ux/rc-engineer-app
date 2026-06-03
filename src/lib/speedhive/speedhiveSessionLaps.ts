import "server-only";

import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import {
  buildSessionPageUrl,
  fetchSessionAllLapTimes,
  fetchSessionClassification,
  parseSpeedhiveLapTimeSeconds,
} from "@/lib/speedhive/speedhiveClient";
import {
  normalizeSpeedhiveDriverNameForMatch,
  speedhiveDriverNameMatches,
} from "@/lib/speedhive/speedhiveNameNormalize";
import { parseSpeedhiveSessionRef } from "@/lib/speedhive/speedhiveUrl";

const PARSER_ID = "speedhive_api_v1";

export function isSpeedhiveSessionUrl(url: string): boolean {
  return parseSpeedhiveSessionRef(url) != null;
}

export async function importSpeedhiveSession(
  urlOrSessionId: string | { sessionId: number; eventId?: number },
  driverName?: string | null
): Promise<LapUrlParseResult> {
  const ref =
    typeof urlOrSessionId === "string"
      ? parseSpeedhiveSessionRef(urlOrSessionId)
      : {
          sessionId: urlOrSessionId.sessionId,
          eventId: urlOrSessionId.eventId,
          sessionUrl: buildSessionPageUrl(urlOrSessionId.eventId, urlOrSessionId.sessionId),
        };

  if (!ref) {
    return {
      parserId: PARSER_ID,
      laps: [],
      candidates: [],
      message: "Unsupported Speedhive URL — paste a session link from speedhive.mylaps.com.",
      errorCode: "unsupported_url",
    };
  }

  try {
    const [classification, lapBlocks] = await Promise.all([
      fetchSessionClassification(ref.sessionId),
      fetchSessionAllLapTimes(ref.sessionId),
    ]);

    const nameByPosition = new Map<number, string>();
    for (const row of classification) {
      if (row.position && row.name?.trim()) {
        nameByPosition.set(row.position, row.name.trim());
      }
    }

    const driverNorm = driverName?.trim()
      ? normalizeSpeedhiveDriverNameForMatch(driverName)
      : "";

    const sessionDrivers: LapUrlSessionDriver[] = [];

    for (const block of lapBlocks) {
      const name = nameByPosition.get(block.position) ?? `P${block.position}`;
      const lapsRaw = block.laps ?? [];
      const laps: number[] = [];
      for (const lap of lapsRaw) {
        if (lap.inPit) continue;
        const sec = parseSpeedhiveLapTimeSeconds(lap.lapTime);
        if (sec != null && sec > 0) laps.push(sec);
      }
      if (laps.length === 0) continue;

      const driverId = `sh-${ref.sessionId}-${block.position}`;
      sessionDrivers.push({
        id: driverId,
        driverId,
        driverName: name,
        normalizedName: name.toLowerCase(),
        laps,
        lapCount: laps.length,
      });
    }

    if (sessionDrivers.length === 0) {
      return {
        parserId: PARSER_ID,
        laps: [],
        candidates: [],
        message: "No lap times found for this Speedhive session.",
        errorCode: "empty_session",
      };
    }

    let primary = sessionDrivers[0]!;
    if (driverNorm) {
      const match = sessionDrivers.find((d) =>
        speedhiveDriverNameMatches(d.driverName, driverNorm)
      );
      if (match) primary = match;
    }

    const sessionMeta = classification[0] as { startTime?: string } | undefined;
    const sessionCompletedAtIso =
      typeof sessionMeta?.startTime === "string" && sessionMeta.startTime.trim()
        ? new Date(sessionMeta.startTime).toISOString()
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
      message: e instanceof Error ? e.message : "Speedhive import failed",
      errorCode: "fetch_failed",
    };
  }
}
