import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { parseHandlingAssessmentJson } from "@/lib/runHandlingAssessment";

export type HintSelectionReason = "same_day_track" | "same_event" | "chrono_prior" | "engineer_fallback";

export type HintBaselineAgeBucket = "same_day" | "this_week" | "this_month" | "older";

export type HintBaselineProvenance = {
  hintReferenceRunId: string;
  engineerReferenceRunId: string | null;
  selectionReason: HintSelectionReason;
  baselineAgeBucket: HintBaselineAgeBucket;
  baselineDisplayLabel: string;
  baselineHandlingPreview: string | null;
  baselineFeelVsLastRun: number | null;
};

export type PrimaryRunForHintReferencePick = {
  id: string;
  carId: string;
  trackId: string | null;
  eventId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  sortAt: Date;
};

function sortMs(run: { createdAt: Date; sessionCompletedAt: Date | null }): number {
  return resolveRunDisplayInstant({
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt,
  }).getTime();
}

/** UTC calendar day key for grouping “same day” sessions. */
export function calendarUtcDayKeyFromInstant(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayKeyFromRunDisplay(run: { createdAt: Date; sessionCompletedAt: Date | null }): string {
  return calendarUtcDayKeyFromInstant(resolveRunDisplayInstant(run));
}

export function hintBaselineAgeBucket(primaryMs: number, refMs: number): HintBaselineAgeBucket {
  const pk = calendarUtcDayKeyFromInstant(new Date(primaryMs));
  const rk = calendarUtcDayKeyFromInstant(new Date(refMs));
  if (pk === rk) return "same_day";
  const days = Math.max(0, Math.floor((primaryMs - refMs) / 86_400_000));
  if (days <= 7) return "this_week";
  if (days <= 35) return "this_month";
  return "older";
}

function runDisplayLabel(run: {
  track: { name: string } | null;
  trackNameSnapshot: string | null;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  loggingCompletedAt: Date | null;
}): string {
  const track = run.track?.name?.trim() || run.trackNameSnapshot?.trim() || "Track";
  const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(run));
  return `${track} · ${when}`;
}

function baselineHandlingPreview(
  handlingProblems: string | null,
  handlingAssessmentJson: unknown
): string | null {
  const bits: string[] = [];
  const hp = handlingProblems?.trim();
  if (hp) bits.push(hp);
  const p = parseHandlingAssessmentJson(handlingAssessmentJson);
  if (p?.feelVsLastRun != null && typeof p.feelVsLastRun === "number" && p.feelVsLastRun !== 0) {
    const f = p.feelVsLastRun;
    bits.push(`Feel vs prior: ${f > 0 ? "+" : ""}${f}`);
  }
  if (!bits.length) return null;
  const s = bits.join(" · ");
  return s.length > 320 ? `${s.slice(0, 319)}…` : s;
}

const carRunSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  sortAt: true,
  loggingCompletedAt: true,
  trackId: true,
  eventId: true,
  track: { select: { name: true } },
  trackNameSnapshot: true,
  handlingProblems: true,
  handlingAssessmentJson: true,
} as const;

/**
 * Picks a chronologically prior run to anchor post-run hints: same calendar day + track,
 * else same event, else immediate prior outing on the car, else Engineer’s default ladder ref.
 */
export async function pickHintContextReferenceRun(
  userId: string,
  primary: PrimaryRunForHintReferencePick,
  engineerReferenceRunId: string | null
): Promise<{ referenceRunId: string | null; provenance: HintBaselineProvenance | null }> {
  const tPrimary = sortMs(primary);
  const engineerRef = engineerReferenceRunId;

  const carRuns = await prisma.run.findMany({
    where: { userId, carId: primary.carId },
    orderBy: [{ sortAt: "desc" }, { createdAt: "desc" }],
    take: 160,
    select: carRunSelect,
  });

  const beforeSorted = carRuns
    .filter((r) => r.id !== primary.id && sortMs(r) < tPrimary)
    .sort((a, b) => sortMs(b) - sortMs(a));

  const primaryDay = dayKeyFromRunDisplay(primary);

  let picked: (typeof carRuns)[number] | null = null;
  let reason: HintSelectionReason | null = null;

  if (primary.trackId) {
    const sameDayTrack = beforeSorted.find(
      (r) => r.trackId === primary.trackId && dayKeyFromRunDisplay(r) === primaryDay
    );
    if (sameDayTrack) {
      picked = sameDayTrack;
      reason = "same_day_track";
    }
  }

  if (!picked && primary.eventId) {
    const sameEvent = beforeSorted.find((r) => r.eventId === primary.eventId);
    if (sameEvent) {
      picked = sameEvent;
      reason = "same_event";
    }
  }

  if (!picked) {
    const idx = carRuns.findIndex((r) => r.id === primary.id);
    const chrono = idx >= 0 && idx < carRuns.length - 1 ? carRuns[idx + 1]! : null;
    if (chrono && sortMs(chrono) < tPrimary) {
      picked = chrono;
      reason = "chrono_prior";
    }
  }

  if (!picked && engineerRef) {
    const fromList = carRuns.find((r) => r.id === engineerRef);
    if (fromList && sortMs(fromList) < tPrimary) {
      picked = fromList;
      reason = "engineer_fallback";
    } else if (engineerRef) {
      const eng = await prisma.run.findFirst({
        where: { id: engineerRef, userId },
        select: carRunSelect,
      });
      if (eng && sortMs(eng) < tPrimary) {
        picked = eng;
        reason = "engineer_fallback";
      }
    }
  }

  if (!picked || !reason) {
    return { referenceRunId: null, provenance: null };
  }

  const refMs = sortMs(picked);
  const bucket = hintBaselineAgeBucket(tPrimary, refMs);
  const feel = parseHandlingAssessmentJson(picked.handlingAssessmentJson)?.feelVsLastRun;
  const feelNum = typeof feel === "number" ? feel : null;

  const provenance: HintBaselineProvenance = {
    hintReferenceRunId: picked.id,
    engineerReferenceRunId: engineerRef,
    selectionReason: reason,
    baselineAgeBucket: bucket,
    baselineDisplayLabel: runDisplayLabel(picked),
    baselineHandlingPreview: baselineHandlingPreview(picked.handlingProblems, picked.handlingAssessmentJson),
    baselineFeelVsLastRun: feelNum,
  };

  return { referenceRunId: picked.id, provenance };
}
