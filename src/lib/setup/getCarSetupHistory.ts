import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime, formatRunDateOnly } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { chassisChangedKeys } from "@/lib/setup/runContextSetupKeys";
import { buildCarSetupHistory, type CarSetupHistoryEntry } from "@/lib/setup/carSetupHistory";
import { setupFieldLabel } from "@/lib/setupCompare/changedSincePrevious";
import { buildCatalogFromTemplate, buildFieldMetaMap } from "@/lib/setupFieldCatalog";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";

/** Runs are filtered in JS (the delta is JSON), so the candidate read is bounded. */
export const CAR_SETUP_HISTORY_CANDIDATE_CAP = 200;

const DEFAULT_LIMIT = 20;

/**
 * What the car is set up with right now: the newest run's setup, whether or not that run changed
 * anything. Automatic on purpose (founder call 2026-07-22) — no pin, no extra column to maintain.
 */
export type CarCurrentSetup = {
  setupId: string;
  runId: string;
  title: string;
  meta: string;
  changedLabels: string[];
};

export type CarSetupHistory = {
  current: CarCurrentSetup | null;
  entries: CarSetupHistoryEntry[];
  /** More entries exist than `limit` let through. */
  hasMore: boolean;
  /** The candidate read hit its cap — older runs exist beyond what was considered. */
  truncated: boolean;
};

export async function getCarSetupHistory(input: {
  userId: string;
  car: { id: string; setupSheetModelId: string | null; setupSheetTemplate: string | null };
  displayTimeZone?: string | null;
  limit?: number;
}): Promise<CarSetupHistory> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const carId = input.car.id;

  const [latestRun, runs, documents, template] = await Promise.all([
    prisma.run.findFirst({
      where: { userId: input.userId, carId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        sessionLabel: true,
        setupSnapshotId: true,
        track: { select: { name: true } },
        event: { select: { name: true } },
        setupSnapshot: { select: { setupDeltaJson: true } },
      },
    }),
    prisma.run.findMany({
      where: {
        userId: input.userId,
        carId,
        setupSnapshot: {
          OR: [{ setupDeltaJson: { not: Prisma.DbNull } }, { baseSetupSnapshotId: null }],
        },
      },
      orderBy: { createdAt: "desc" },
      take: CAR_SETUP_HISTORY_CANDIDATE_CAP,
      select: {
        id: true,
        createdAt: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        sessionLabel: true,
        setupSnapshotId: true,
        track: { select: { name: true } },
        event: { select: { name: true } },
        setupSnapshot: { select: { setupDeltaJson: true, baseSetupSnapshotId: true } },
      },
    }),
    prisma.setupDocument.findMany({
      where: { userId: input.userId, carId, setupImportBatchId: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalFilename: true,
        createdAt: true,
        parseStatus: true,
        createdSetupId: true,
      },
    }),
    getSetupSheetTemplateForCar(input.userId, input.car, "setup"),
  ]);

  // Labels come from the car's own sheet, so a Mugen ARB reads like a Mugen ARB.
  const fieldMeta = buildFieldMetaMap(buildCatalogFromTemplate(template));
  const labelForKey = (key: string): string => fieldMeta.get(key)?.label ?? setupFieldLabel(key);

  const entries = buildCarSetupHistory({
    carId,
    runs,
    documents,
    labelForKey,
    formatDate: (at) => formatRunDateOnly(at, input.displayTimeZone),
  });

  const current: CarCurrentSetup | null = latestRun
    ? {
        setupId: latestRun.setupSnapshotId,
        runId: latestRun.id,
        title: (() => {
          const session = formatRunSessionDisplay(latestRun, { fallback: "Testing run" });
          return latestRun.event?.name ? `${latestRun.event.name} · ${session}` : session;
        })(),
        meta: [
          latestRun.track?.name,
          formatRunCreatedAtDateTime(latestRun.createdAt, input.displayTimeZone),
        ]
          .filter(Boolean)
          .join(" · "),
        changedLabels: chassisChangedKeys(latestRun.setupSnapshot?.setupDeltaJson).map(labelForKey),
      }
    : null;

  return {
    current,
    entries: entries.slice(0, limit),
    hasMore: entries.length > limit,
    truncated: runs.length >= CAR_SETUP_HISTORY_CANDIDATE_CAP,
  };
}
