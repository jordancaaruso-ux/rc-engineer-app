import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime, formatRunDateOnly } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  buildCarSetupHistory,
  carSetupCounts,
  runToRunChangedKeys,
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

/**
 * How many runs back the list looks.
 *
 * Every candidate now costs its whole `SetupSnapshot.data` blob — a filled A800RR sheet is ~280
 * fields — because "did this run change the car" is answered by comparing values, not by reading a
 * stored delta. 200 candidates was affordable when the read was one small JSON column per run; it is
 * not affordable now, and the old cap was pointless anyway: the card only ever rendered 20 rows.
 *
 * One extra run beyond the window is read as the diff anchor (see `setupBeforeOldestRun`).
 */
export const CAR_SETUP_HISTORY_CANDIDATE_CAP = 60;

/**
 * Hard ceiling on entries handed to the card — a backstop, not the display length. The card draws a
 * short head and expands on tap, and the run window above is what actually bounds the list.
 */
const DEFAULT_LIMIT = 200;

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
  /** The run window hit its cap — older runs exist that were never checked for changes. */
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

  const [runRows, documents, librarySetups, baselineRows, template] = await Promise.all([
    /*
     * EVERY run on the car, newest first — no "did the delta have keys" filter any more. Whether a
     * run changed the car is decided by comparing its values with the run before it, which means
     * every run is a candidate and none can be excluded in SQL.
     *
     * `sortAt` is the ordering axis so "the run before it" means the run that actually preceded it
     * on track, not the row that happened to be written first. One extra row past the cap is the
     * anchor the oldest visible run diffs against.
     */
    prisma.run.findMany({
      where: { userId: input.userId, carId },
      orderBy: { sortAt: "desc" },
      take: CAR_SETUP_HISTORY_CANDIDATE_CAP + 1,
      select: {
        id: true,
        sortAt: true,
        createdAt: true,
        sessionCompletedAt: true,
        loggingCompletedAt: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        sessionLabel: true,
        setupSnapshotId: true,
        track: { select: { name: true } },
        event: { select: { name: true } },
        setupSnapshot: {
          select: {
            data: true,
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
      select: {
        id: true,
        name: true,
        createdAt: true,
        data: true,
        // Where a forked setup started, so the row can say so instead of appearing from nowhere.
        baseSetupSnapshot: { select: { name: true } },
        sourceBaseline: { select: { name: true } },
      },
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

  /*
   * The extra row past the cap is the anchor, not an entry. It never earns a row of its own — it
   * exists so the oldest run in the window has something to be compared against. When the read came
   * back short of the cap there is no anchor, and the oldest run is genuinely the car's first.
   */
  const truncated = runRows.length > CAR_SETUP_HISTORY_CANDIDATE_CAP;
  const windowRuns = truncated ? runRows.slice(0, CAR_SETUP_HISTORY_CANDIDATE_CAP) : runRows;
  const anchorRun = truncated ? runRows[CAR_SETUP_HISTORY_CANDIDATE_CAP] : null;

  const runs = windowRuns.map((r) => ({
    id: r.id,
    sortAt: r.sortAt,
    displayAt: resolveRunDisplayInstant(r),
    sessionType: r.sessionType,
    meetingSessionType: r.meetingSessionType,
    meetingSessionCode: r.meetingSessionCode,
    sessionLabel: r.sessionLabel,
    setupSnapshotId: r.setupSnapshotId,
    track: r.track,
    event: r.event,
    setupSnapshot: r.setupSnapshot,
  }));

  const entries = buildCarSetupHistory({
    carId,
    runs,
    setupBeforeOldestRun: anchorRun?.setupSnapshot?.data ?? null,
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
      editedFrom: s.baseSetupSnapshot?.name ?? null,
      copiedFrom: s.sourceBaseline?.name ?? null,
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

  /*
   * What the car is on right now = the newest run, changed or not. It comes off the same read as the
   * list (the newest row by `sortAt`), so the card and the list can never disagree about which run
   * is latest — they used to be two queries ordered on two different columns.
   */
  const latestRun = windowRuns[0] ?? null;
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
          formatRunCreatedAtDateTime(resolveRunDisplayInstant(latestRun), input.displayTimeZone),
        ]
          .filter(Boolean)
          .join(" · "),
        /*
         * The same run-to-run rule the list uses, so the card's chips and the top row's chips agree.
         * With no second run there is nothing to diff against, and the chips are empty — comparing
         * against "nothing" would list every field on the sheet as a change.
         */
        changedLabels: windowRuns[1]
          ? runToRunChangedKeys(
              latestRun.setupSnapshot?.data,
              windowRuns[1].setupSnapshot?.data ?? null
            ).map(labelForKey)
          : [],
        saved: Boolean(latestRun.setupSnapshot?.isLibrary),
      }
    : null;

  return {
    current,
    entries: entries.slice(0, limit),
    // Counted before the slice: a chip must report what the car has, not what this page shows.
    counts: carSetupCounts(entries),
    truncated,
  };
}
