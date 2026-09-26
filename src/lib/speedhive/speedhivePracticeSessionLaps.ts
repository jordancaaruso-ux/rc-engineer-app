import "server-only";

import type { LapUrlParseResult, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { fetchPracticeActivity, fetchPracticeTrainingSessions } from "@/lib/speedhive/speedhivePracticeClient";
import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";
import {
  parseSpeedhivePracticeActivityRef,
  buildSpeedhivePracticeActivityUrl,
  buildSpeedhivePracticeRunUrl,
  isSpeedhivePracticeLocationPageUrl,
} from "@/lib/speedhive/speedhivePracticeUrl";
import { isSpeedhiveOrApiUrl } from "@/lib/speedhive/speedhiveUrl";
import { speedhivePracticeUtcOffsetMinutes } from "@/lib/speedhive/speedhiveSessionTime";

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

/**
 * Track-local wall clock from the API's `dateTimeStart` (ISO, usually with an
 * offset). Formats the literal date-time portion as written — no zone conversion —
 * so the run label matches the clock at the track. This code runs on the server
 * (UTC) with no viewer timezone available, and the label is persisted into the
 * imported payload, so converting via `new Date(...).toLocaleString()` would bake
 * in the server zone instead.
 */
function practiceRunWallClockLabel(raw: string): string | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, min] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min)));
  if (Number.isNaN(dt.getTime())) return null;
  return formatRunCreatedAtDateTime(dt, "UTC");
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
        typeof urlOrRef === "string" && isSpeedhivePracticeLocationPageUrl(urlOrRef)
          ? "That link is the track's practice page, not one session. Open your session on Speedhive and paste its link."
          : "Unsupported Speedhive practice URL — use a link from your track practice page.",
      errorCode: "unsupported_url",
    };
  }

  try {
    /*
     * The visit itself says whose it was — its chip and the label its owner gave it. Kept on the
     * session so the run can be named (founder call 2026-09-23: "a run should never just say
     * run x"). Its own failure never costs the laps.
     */
    const [trainingSessions, activity] = await Promise.all([
      fetchPracticeTrainingSessions(ref.activityId),
      fetchPracticeActivity(ref.activityId),
    ]);
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
      const whenLabel = (when ? practiceRunWallClockLabel(when) : null) ?? `Run ${block.id}`;
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

    const chip = activity?.chipCode ? normalizeSpeedhiveTransponderNumber(activity.chipCode) : null;
    const chipLabel = activity?.chipLabel?.trim() || null;
    const locationName = activity?.location?.name?.trim() || null;

    // A link that names only the visit is filed under the address URL Auto uses, once the practice
    // API has said which location the visit was at.
    const locationId = activity?.location?.id;
    const canonicalUrl =
      ref.locationId == null && typeof locationId === "number" && locationId > 0
        ? ref.trainingSessionId != null
          ? buildSpeedhivePracticeRunUrl(locationId, ref.activityId, ref.trainingSessionId)
          : buildSpeedhivePracticeActivityUrl(locationId, ref.activityId)
        : null;

    return {
      parserId: PARSER_ID,
      ...(canonicalUrl ? { canonicalUrl } : {}),
      laps: primary.laps,
      sessionDrivers,
      sessionHint: {
        name: primary.driverName,
        ...(chip ? { practiceTransponder: chip } : {}),
        ...(chipLabel ? { practiceSiteName: chipLabel } : {}),
        ...(locationName ? { practiceLocationName: locationName } : {}),
      },
      sessionCompletedAtIso,
      sessionUtcOffsetMinutes: speedhivePracticeUtcOffsetMinutes(blocks),
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

/**
 * A practice link this importer answers for. A club's practice page is one: it has no laps, and the
 * generic page reader it used to fall through to blamed the site ("may load results in JavaScript
 * only") instead of saying which link to paste.
 */
export function isSpeedhivePracticeImportUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || !isSpeedhiveOrApiUrl(trimmed)) return false;
  return isSpeedhivePracticeActivityUrl(trimmed) || isSpeedhivePracticeLocationPageUrl(trimmed);
}
