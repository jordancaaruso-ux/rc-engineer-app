import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime, formatRunDateOnly } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { chassisChangedKeys } from "@/lib/setup/runContextSetupKeys";
import {
  buildCarSetupHistory,
  carSetupCounts,
  type CarSetupCounts,
  type CarSetupHistoryEntry,
} from "@/lib/setup/carSetupHistory";
import {
  BASELINE_KIND_LABEL,
  baselineContextLabel,
  sortBaselineSetups,
  type BaselineSetupKindValue,
} from "@/lib/baselineSetups/baselineSetupShape";
import { normalizeSetupData } from "@/lib/runSetup";
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
  /** Already in the driver's saved setups — the card's Save button starts filled. */
  saved: boolean;
};

export type CarSetupHistory = {
  current: CarCurrentSetup | null;
  entries: CarSetupHistoryEntry[];
  /** Counts before the limit, so a chip says how much is really behind it. */
  counts: CarSetupCounts;
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

  const [latestRun, runs, documents, librarySetups, baselineRows, template] = await Promise.all([
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
        setupSnapshot: { select: { setupDeltaJson: true, isLibrary: true, name: true } },
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
        setupSnapshot: {
          select: {
            setupDeltaJson: true,
            baseSetupSnapshotId: true,
            // Saving a run's setup flags this very row rather than copying it, so the list has to
            // read the flag to know which bookmarks are filled.
            isLibrary: true,
            name: true,
          },
        },
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
        createdSetup: {
          select: { isLibrary: true, name: true, _count: { select: { runs: true } } },
        },
      },
    }),
    /*
     * Saved setups that no run and no sheet accounts for — one built from a blank sheet, or copied
     * off a baseline. Saved run/sheet setups are NOT read here: they already arrive above carrying
     * `isLibrary`, and reading them twice would put the same setup in the list twice, which is the
     * duplication this rebuild exists to remove.
     */
    prisma.setupSnapshot.findMany({
      where: {
        userId: input.userId,
        carId,
        isLibrary: true,
        runs: { none: {} },
        sourceDocuments: { none: {} },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, name: true, createdAt: true, data: true },
    }),
    // Baselines are global rows published against the chassis — never scope this read by userId.
    input.car.setupSheetModelId
      ? prisma.baselineSetup.findMany({
          where: { setupSheetModelId: input.car.setupSheetModelId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            kind: true,
            notes: true,
            surface: true,
            gripLevel: true,
            data: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    getSetupSheetTemplateForCar(input.userId, input.car, "setup"),
  ]);

  // Labels come from the car's own sheet, so a Mugen ARB reads like a Mugen ARB.
  const fieldMeta = buildFieldMetaMap(buildCatalogFromTemplate(template));
  const labelForKey = (key: string): string => fieldMeta.get(key)?.label ?? setupFieldLabel(key);

  const entries = buildCarSetupHistory({
    carId,
    runs,
    documents: documents.map((d) => ({
      ...d,
      createdSetup: d.createdSetup
        ? {
            isLibrary: d.createdSetup.isLibrary,
            name: d.createdSetup.name,
            runCount: d.createdSetup._count.runs,
          }
        : null,
    })),
    librarySetups: librarySetups.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      valueCount: Object.keys(normalizeSetupData(s.data)).length,
      runCount: 0,
    })),
    baselines: sortBaselineSetups(
      baselineRows.map((b) => ({ ...b, kind: b.kind as BaselineSetupKindValue }))
    ).map((b) => ({
      id: b.id,
      name: b.name,
      createdAt: b.createdAt,
      kindLabel: BASELINE_KIND_LABEL[b.kind],
      contextLabel: baselineContextLabel(b),
      valueCount: Object.keys(normalizeSetupData(b.data)).length,
      notes: b.notes,
    })),
    labelForKey,
    formatDate: (at) => formatRunDateOnly(at, input.displayTimeZone),
  });

  const current: CarCurrentSetup | null = latestRun
    ? {
        setupId: latestRun.setupSnapshotId,
        runId: latestRun.id,
        title: (() => {
          // Once saved, the driver's own name for it wins — same rule as the list below.
          const snap = latestRun.setupSnapshot;
          if (snap?.isLibrary && snap.name) return snap.name;
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
        saved: Boolean(latestRun.setupSnapshot?.isLibrary),
      }
    : null;

  return {
    current,
    entries: entries.slice(0, limit),
    // Counted before the slice: a chip must report what the car has, not what this page shows.
    counts: carSetupCounts(entries),
    hasMore: entries.length > limit,
    truncated: runs.length >= CAR_SETUP_HISTORY_CANDIDATE_CAP,
  };
}
