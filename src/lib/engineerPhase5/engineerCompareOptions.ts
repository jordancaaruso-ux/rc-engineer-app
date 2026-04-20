import "server-only";

import { prisma } from "@/lib/prisma";
import { getIncludedLapDashboardMetrics, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { resolveRunDisplayInstant, resolveRunSortInstant } from "@/lib/runCompareMeta";
import { hasTeammateLink } from "@/lib/teammateRunAccess";
import type { EngineerCompareOptionRow, EngineerCompareOptionsPayload } from "@/lib/engineerPhase5/engineerCompareOptionsTypes";

export type { EngineerCompareOptionRow, EngineerCompareOptionsPayload };

function sortInstantMs(run: {
  createdAt: Date;
  sessionCompletedAt: Date | null;
  sortAt: Date | null;
}): number {
  // Match the Sessions page chronology — pick the `sortAt` axis so the
  // Engineer compare dropdown agrees with whatever order the driver has
  // arranged their run history into.
  return resolveRunSortInstant({
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt,
    sortAt: run.sortAt,
  }).getTime();
}

function rowToOption(
  run: {
    id: string;
    createdAt: Date;
    sessionCompletedAt: Date | null;
    sortAt: Date | null;
    sessionType: string;
    meetingSessionType: string | null;
    meetingSessionCode: string | null;
    sessionLabel: string | null;
    carNameSnapshot: string | null;
    lapTimes: unknown;
    lapSession: unknown;
    car: { name: string } | null;
    track: { name: string } | null;
  },
  owner: "me" | "teammate",
  teammateLabel: string | null
): EngineerCompareOptionRow {
  const when = resolveRunDisplayInstant({
    createdAt: run.createdAt,
    sessionCompletedAt: run.sessionCompletedAt,
  });
  const session = formatRunSessionDisplay({
    sessionType: run.sessionType,
    meetingSessionType: run.meetingSessionType,
    meetingSessionCode: run.meetingSessionCode,
    sessionLabel: run.sessionLabel,
  });
  const carName = run.car?.name ?? run.carNameSnapshot ?? "—";
  const trackName = run.track?.name ?? "—";
  const dash = getIncludedLapDashboardMetrics(primaryLapRowsFromRun(run));
  const label = `${session} · ${carName} · ${trackName} · ${formatRunCreatedAtDateTime(when)}${
    dash.bestLap != null ? ` · best ${dash.bestLap.toFixed(3)} s` : ""
  }`;
  return {
    runId: run.id,
    sortIso: when.toISOString(),
    label,
    carName,
    trackName,
    owner,
    teammateLabel,
  };
}

const runSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  sortAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carNameSnapshot: true,
  lapTimes: true,
  lapSession: true,
  car: { select: { name: true } },
  track: { select: { name: true } },
} as const;

/**
 * All runs the viewer may select for Engineer compare (mine + linked teammates).
 */
export async function buildEngineerCompareOptions(viewerUserId: string): Promise<EngineerCompareOptionsPayload> {
  const mineRaw = await prisma.run.findMany({
    where: { userId: viewerUserId },
    orderBy: { sortAt: "desc" },
    take: 200,
    select: runSelect,
  });
  const mine = [...mineRaw]
    .sort((a, b) => sortInstantMs(b) - sortInstantMs(a))
    .map((r) => rowToOption(r, "me", null));

  const links = await prisma.teammateLink.findMany({
    where: { userId: viewerUserId },
    select: {
      peerUserId: true,
      peer: { select: { name: true, email: true } },
    },
  });

  const teammates: Array<{ peerUserId: string; displayName: string; runs: EngineerCompareOptionRow[] }> = [];
  for (const l of links) {
    const allowed = await hasTeammateLink(viewerUserId, l.peerUserId);
    if (!allowed) continue;
    const displayName = l.peer.name?.trim() || l.peer.email?.trim() || l.peerUserId.slice(0, 8);
    const peerRuns = await prisma.run.findMany({
      where: { userId: l.peerUserId },
      orderBy: { sortAt: "desc" },
      take: 120,
      select: runSelect,
    });
    const runs = [...peerRuns]
      .sort((a, b) => sortInstantMs(b) - sortInstantMs(a))
      .map((r) => rowToOption(r, "teammate", displayName));
    teammates.push({ peerUserId: l.peerUserId, displayName, runs });
  }

  return { mine, teammates };
}
