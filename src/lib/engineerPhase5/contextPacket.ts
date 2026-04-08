import "server-only";

import { prisma } from "@/lib/prisma";
import { computeIncludedLapMetricsFromRun } from "@/lib/lapAnalysis";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";

export type EngineerContextPacketV1 = {
  version: 1;
  generatedAtIso: string;
  user: { id: string };
  latestRun: null | {
    id: string;
    createdAtIso: string;
    createdAtLabel: string;
    sessionTypeLabel: string;
    carName: string;
    trackName: string;
    eventName: string | null;
    lapSummary: {
      lapCount: number;
      bestLapSeconds: number | null;
      avgTop5Seconds: number | null;
    } | null;
    setup: {
      hasSetupSnapshot: boolean;
      setupDeltaKeys: string[];
      setupDeltaKeyCount: number;
    };
    notesPreview: string | null;
  };
  previousRun: null | {
    id: string;
    createdAtIso: string;
    createdAtLabel: string;
    sessionTypeLabel: string;
    carName: string;
    trackName: string;
    lapSummary: {
      lapCount: number;
      bestLapSeconds: number | null;
      avgTop5Seconds: number | null;
    } | null;
  };
  comparison: null | {
    lapDeltaSummary: {
      bestLapDeltaSeconds: number | null;
      avgTop5DeltaSeconds: number | null;
      direction: "improved" | "regressed" | "flat" | "unknown";
    };
    setupChangeSummary: {
      changedKeyCount: number;
      changedKeysSample: string[];
    };
  };
  thingsToTry: Array<{ id: string; text: string }>;
};

type LapSummary = {
  lapCount: number;
  bestLapSeconds: number | null;
  avgTop5Seconds: number | null;
} | null;

function clampNotePreview(raw: string | null | undefined, max = 220): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function safeKeysFromJsonObject(v: unknown): string[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.keys(v as Record<string, unknown>).sort();
}

function lapSummaryFromRun(run: { lapTimes: unknown; lapSession?: unknown } | null): LapSummary {
  if (!run) return null;
  const m = computeIncludedLapMetricsFromRun(run);
  return {
    lapCount: m.lapCount,
    bestLapSeconds: m.bestLap ?? null,
    avgTop5Seconds: (m as { averageTop5?: number | null }).averageTop5 ?? null,
  };
}

function deltaDirection(delta: number | null): "improved" | "regressed" | "flat" | "unknown" {
  if (delta == null || !Number.isFinite(delta)) return "unknown";
  if (Math.abs(delta) < 1e-6) return "flat";
  return delta < 0 ? "improved" : "regressed";
}

/**
 * Phase 5 V1 context packet:
 * - deterministic, compact, user-scoped
 * - does not include raw lap-by-lap tables
 */
export async function buildEngineerContextPacketV1(userId: string): Promise<EngineerContextPacketV1> {
  const thingsToTry = await prisma.actionItem.findMany({
    where: { userId, isArchived: false },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, text: true },
  });

  const latest = await prisma.run.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      sessionLabel: true,
      lapTimes: true,
      lapSession: true,
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
      setupSnapshot: { select: { id: true, setupDeltaJson: true } },
      carId: true,
    },
  });

  if (!latest) {
    return {
      version: 1,
      generatedAtIso: new Date().toISOString(),
      user: { id: userId },
      latestRun: null,
      previousRun: null,
      comparison: null,
      thingsToTry: thingsToTry.map((t) => ({ id: t.id, text: t.text })),
    };
  }

  const prev = latest.carId
    ? await prisma.run.findFirst({
        where: { userId, carId: latest.carId, id: { not: latest.id } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          sessionType: true,
          meetingSessionType: true,
          meetingSessionCode: true,
          sessionLabel: true,
          lapTimes: true,
          lapSession: true,
          carNameSnapshot: true,
          trackNameSnapshot: true,
          car: { select: { name: true } },
          track: { select: { name: true } },
          setupSnapshot: { select: { id: true, setupDeltaJson: true } },
        },
      })
    : null;

  const latestCarName = latest.car?.name ?? latest.carNameSnapshot ?? "—";
  const latestTrackName = latest.track?.name ?? latest.trackNameSnapshot ?? "—";
  const latestSession = formatRunSessionDisplay({
    sessionType: latest.sessionType,
    meetingSessionType: latest.meetingSessionType,
    meetingSessionCode: latest.meetingSessionCode,
    sessionLabel: latest.sessionLabel,
  });

  const prevCarName = prev?.car?.name ?? prev?.carNameSnapshot ?? latestCarName;
  const prevTrackName = prev?.track?.name ?? prev?.trackNameSnapshot ?? "—";
  const prevSession = prev
    ? formatRunSessionDisplay({
        sessionType: prev.sessionType,
        meetingSessionType: prev.meetingSessionType,
        meetingSessionCode: prev.meetingSessionCode,
        sessionLabel: prev.sessionLabel,
      })
    : "";

  const latestLap = lapSummaryFromRun(latest);
  const prevLap = prev ? lapSummaryFromRun(prev) : null;

  const bestDelta =
    latestLap?.bestLapSeconds != null && prevLap?.bestLapSeconds != null
      ? latestLap.bestLapSeconds - prevLap.bestLapSeconds
      : null;
  const top5Delta =
    latestLap?.avgTop5Seconds != null && prevLap?.avgTop5Seconds != null
      ? latestLap.avgTop5Seconds - prevLap.avgTop5Seconds
      : null;

  const latestSetupDeltaKeys = safeKeysFromJsonObject(latest.setupSnapshot?.setupDeltaJson);
  const prevSetupDeltaKeys = safeKeysFromJsonObject(prev?.setupSnapshot?.setupDeltaJson);
  const setupKeysUnion = Array.from(new Set([...latestSetupDeltaKeys, ...prevSetupDeltaKeys])).sort();

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    user: { id: userId },
    latestRun: {
      id: latest.id,
      createdAtIso: latest.createdAt.toISOString(),
      createdAtLabel: formatRunCreatedAtDateTime(latest.createdAt),
      sessionTypeLabel: latestSession,
      carName: latestCarName,
      trackName: latestTrackName,
      eventName: latest.event?.name ?? null,
      lapSummary: latestLap,
      setup: {
        hasSetupSnapshot: Boolean(latest.setupSnapshot?.id),
        setupDeltaKeys: latestSetupDeltaKeys,
        setupDeltaKeyCount: latestSetupDeltaKeys.length,
      },
      notesPreview: clampNotePreview(latest.notes ?? latest.driverNotes ?? latest.handlingProblems ?? null),
    },
    previousRun: prev
      ? {
          id: prev.id,
          createdAtIso: prev.createdAt.toISOString(),
          createdAtLabel: formatRunCreatedAtDateTime(prev.createdAt),
          sessionTypeLabel: prevSession,
          carName: prevCarName,
          trackName: prevTrackName,
          lapSummary: prevLap,
        }
      : null,
    comparison: prev
      ? {
          lapDeltaSummary: {
            bestLapDeltaSeconds: bestDelta,
            avgTop5DeltaSeconds: top5Delta,
            direction: deltaDirection(top5Delta ?? bestDelta),
          },
          setupChangeSummary: {
            changedKeyCount: setupKeysUnion.length,
            changedKeysSample: setupKeysUnion.slice(0, 12),
          },
        }
      : null,
    thingsToTry: thingsToTry.map((t) => ({ id: t.id, text: t.text })),
  };
}

