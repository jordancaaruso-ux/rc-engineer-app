import { prisma } from "@/lib/prisma";
import { normalizeSetupData } from "@/lib/runSetup";
import { buildSetupDiffRows } from "@/lib/setupDiff";
import {
  buildSetupSpreadForEngineer,
  type EngineerCommunityContext,
  type EngineerSetupSpreadRow,
} from "@/lib/engineerPhase5/setupSpreadForEngineer";
import {
  MAX_RUNS_BASED_ON_IT,
  shapeSavedSetupComboDiff,
  shapeSavedSetupRunOutcomes,
  type SavedSetupAnchorComboDiff,
  type SavedSetupAnchorRunOutcome,
} from "@/lib/engineerPhase5/savedSetupAnchorShape";
import { formatRunSessionDisplay } from "@/lib/runSession";

/**
 * Context block for a saved (library) setup anchor — the first time a setup reaches
 * the Engineer standalone rather than through a run. Values + community-spread
 * positioning + which runs were based on it and how they went; plus, in the
 * run+setup combo, the diff against the anchored run's own sheet.
 * Pure shaping lives in savedSetupAnchorShape.ts.
 */

export type SavedSetupAnchorContextV1 = {
  version: 1;
  setupId: string;
  name: string | null;
  carId: string | null;
  carName: string | null;
  createdAtLabel: string;
  /** Full resolved sheet, labeled. */
  values: Array<{ key: string; label: string; display: string }>;
  setupVsSpread: {
    communityContext: EngineerCommunityContext;
    rows: EngineerSetupSpreadRow[];
    truncated: boolean;
  };
  runsBasedOnIt: SavedSetupAnchorRunOutcome[];
  /**
   * Run + setup combo only ("would this sheet have helped here?"): changed rows,
   * `thisSetup` = this library setup, `anchoredRun` = the pinned run's sheet.
   */
  vsAnchoredRunDiff: SavedSetupAnchorComboDiff | null;
};

export async function buildSavedSetupAnchorContext(params: {
  userId: string;
  setupId: string;
  /** Present in the run+setup combo — the pinned run to diff against. */
  anchoredRunId?: string | null;
  timeZone?: string | null;
}): Promise<SavedSetupAnchorContextV1 | null> {
  // Ownership + isLibrary re-checked here — the id comes from the client.
  const snap = await prisma.setupSnapshot.findFirst({
    where: { id: params.setupId, userId: params.userId, isLibrary: true },
    select: {
      id: true,
      name: true,
      createdAt: true,
      data: true,
      carId: true,
      car: { select: { name: true } },
    },
  });
  if (!snap) return null;

  const libraryData = normalizeSetupData(snap.data);

  const [spread, basedOnRuns, anchoredRun] = await Promise.all([
    buildSetupSpreadForEngineer({
      userId: params.userId,
      carId: snap.carId,
      setupSnapshotData: snap.data,
    }),
    prisma.run.findMany({
      where: { userId: params.userId, setupSnapshot: { baseSetupSnapshotId: snap.id } },
      orderBy: { sortAt: "desc" },
      take: MAX_RUNS_BASED_ON_IT,
      select: {
        id: true,
        createdAt: true,
        sessionLabel: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        trackNameSnapshot: true,
        track: { select: { name: true } },
        bestLapSeconds: true,
        carRating: true,
        setupSnapshot: { select: { data: true } },
      },
    }),
    params.anchoredRunId
      ? prisma.run.findFirst({
          where: { id: params.anchoredRunId, userId: params.userId },
          select: { id: true, setupSnapshot: { select: { data: true } } },
        })
      : Promise.resolve(null),
  ]);

  const tz = params.timeZone?.trim() || undefined;
  const whenFmt = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(tz ? { timeZone: tz } : {}),
  });

  const valueRows = buildSetupDiffRows(libraryData, null).filter((row) => row.current !== "—");

  return {
    version: 1,
    setupId: snap.id,
    name: snap.name,
    carId: snap.carId,
    carName: snap.car?.name ?? null,
    createdAtLabel: whenFmt.format(snap.createdAt),
    values: valueRows.map((row) => ({ key: row.key, label: row.label, display: row.current })),
    setupVsSpread: {
      communityContext: spread.communityContext,
      rows: spread.rows,
      truncated: spread.truncated,
    },
    runsBasedOnIt: shapeSavedSetupRunOutcomes(
      libraryData,
      basedOnRuns.map((run) => ({
        id: run.id,
        whenLabel: whenFmt.format(run.createdAt),
        sessionLabel: formatRunSessionDisplay(run, { fallback: "Run" }),
        trackName: run.track?.name ?? run.trackNameSnapshot ?? null,
        bestLapSeconds: run.bestLapSeconds,
        carRating: run.carRating,
        snapshotData: run.setupSnapshot?.data,
      }))
    ),
    vsAnchoredRunDiff: anchoredRun
      ? shapeSavedSetupComboDiff(libraryData, anchoredRun.id, anchoredRun.setupSnapshot?.data)
      : null,
  };
}

/** Best related run for rich-context anchoring when only a setup is pinned. */
export async function resolveSetupAnchorDerivedRunId(params: {
  userId: string;
  setupId: string;
  carId: string | null;
}): Promise<string | null> {
  const basedOn = await prisma.run.findFirst({
    where: { userId: params.userId, setupSnapshot: { baseSetupSnapshotId: params.setupId } },
    orderBy: { sortAt: "desc" },
    select: { id: true },
  });
  if (basedOn) return basedOn.id;
  if (!params.carId) return null;
  const onCar = await prisma.run.findFirst({
    where: { userId: params.userId, carId: params.carId },
    orderBy: { sortAt: "desc" },
    select: { id: true },
  });
  return onCar?.id ?? null;
}
