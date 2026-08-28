import "server-only";

import { prisma } from "@/lib/prisma";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { importedSessionTitle } from "@/lib/lapImport/sessionTitle";
import {
  resolveImportedSessionDisplayTimeIso,
  timingSourceFromParserId,
  timingSourceFromSourceUrl,
} from "@/lib/lapImport/labels";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";

/**
 * An imported timing session, dressed as something the lap sheet can anchor on.
 *
 * The sheet has always been welded to a Run: it measures every column against one the
 * viewer drove, which quietly made lap analysis a thing only the driver who logged the
 * session could do. A team manager reading their driver's heat, or anyone watching a
 * meeting on the other side of the world, had nowhere to stand.
 *
 * Nothing about the comparison actually needs a Run — it needs laps, a name, an instant
 * and a field. This builds exactly that out of an import, so `/laps/analysis` can open
 * the same sheet with no run behind it. It is a VIEW of an import, not a stored row:
 * nothing here is written back, and the session stays unlinked and unowned by any run.
 *
 * The synthetic id is `import:<sessionId>` and can never collide with a Run id, which is
 * what keeps the sheet's "exclude the current run" filters honest.
 */

/** Anything not `RACE_MEETING` / `PRACTICE` makes `formatRunSessionDisplay` print our label verbatim. */
const IMPORTED_SESSION_TYPE = "IMPORTED";

export type ImportedSessionAnchor = {
  sessionId: string;
  /** What the sheet header calls it — "ISTC Modified A-Main", "Practice". */
  title: string;
  /** Timing host, for the line under the title. */
  sourceLabel: string | null;
  sourceUrl: string;
  /** On-track instant when timing gave one, else when it was imported. */
  whenIso: string;
  trackName: string | null;
  /** Entrants with laps. One for a practice sheet, a whole grid for a race. */
  driverCount: number;
  /**
   * The driver the sheet opens on. The viewer's own row when we can spot it (their name
   * is on the timing sheet), otherwise the classification leader — on a race nobody here
   * drove, the winner is the only column with a claim to being the default.
   */
  anchorDriverName: string;
  /** True when `anchorDriverName` is the viewer, which is what "(my runs)" wording keys off. */
  anchorIsViewer: boolean;
  run: CompareRunShape;
};

function lapsTotal(laps: number[]): number {
  let sum = 0;
  for (const t of laps) sum += t;
  return sum;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Every entrant's laps, in classification order (most laps, then lowest total time).
 *
 * Same reconstruction `loadRaceFieldForRun` does, and for the same reason: timing sites
 * publish the sheet, not the result, so finishing order is inferred and penalties applied
 * off-track are invisible either way.
 */
export async function loadImportedSessionAnchor(
  userId: string,
  sessionId: string,
  opts?: { viewerNames?: string[] }
): Promise<ImportedSessionAnchor | null> {
  const row = await prisma.importedLapTimeSession.findFirst({
    // Scoped to the viewer's own imports. An import is a private artefact of one
    // account even when the race it describes was public — see ASSET_ACCESS.
    where: { id: sessionId, userId },
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sourceUrl: true,
      parserId: true,
      parsedPayload: true,
      linkedEventId: true,
      eventDetectionSource: true,
      eventDetectionSessionLabel: true,
      eventRaceClass: true,
      linkedRun: {
        select: { trackNameSnapshot: true, track: { select: { id: true, name: true } } },
      },
      linkedEvent: { select: { name: true, track: { select: { id: true, name: true } } } },
    },
  });
  if (!row) return null;

  const drivers = (rawSessionDriversFromImportedPayload(row.parsedPayload) ?? []).filter(
    (d) => d.laps.length > 0
  );
  if (drivers.length === 0) return null;

  const ordered = [...drivers].sort(
    (a, b) => b.laps.length - a.laps.length || lapsTotal(a.laps) - lapsTotal(b.laps)
  );

  const viewerNorms = new Set((opts?.viewerNames ?? []).map(normalizeName).filter(Boolean));
  const mine = viewerNorms.size > 0 ? ordered.find((d) => viewerNorms.has(normalizeName(d.driverName))) : undefined;
  const anchor = mine ?? ordered[0]!;

  const whenIso = resolveImportedSessionDisplayTimeIso({
    sessionCompletedAt: row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null,
    parsedPayload: row.parsedPayload,
    createdAt: row.createdAt.toISOString(),
  });

  /*
   * Auto-exclude runs over EVERY driver here, the anchor included — the opposite of the
   * run page, where the viewer's own column carries their hand-picked exclusions and must
   * never be second-guessed. Nobody has hand-picked anything on an import of a race they
   * watched, so the alternative isn't "honest raw laps", it's a marshal call setting the
   * scale for the whole grid.
   */
  const sets = ordered.map((d) => {
    const rows = applyMedianBandAutoExclude(
      d.laps.map((t, li) => ({ lapNumber: li + 1, lapTimeSeconds: t, isIncluded: true }))
    );
    return {
      id: `${row.id}:${d.id}`,
      createdAt: row.createdAt.toISOString(),
      sessionCompletedAt: row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null,
      sourceUrl: row.sourceUrl,
      driverName: d.driverName,
      displayName: d.driverName,
      normalizedName: d.normalizedName,
      /*
       * The anchor's own row is the one flagged primary, whoever they are. On a race the
       * viewer is not in, "primary" means "the column this sheet opens on" — the flag
       * drives which set the sheet folds into the target column, not who owns anything.
       */
      isPrimaryUser: d.id === anchor.id,
      laps: rows,
    };
  });

  const trackName =
    row.linkedEvent?.track?.name?.trim() ||
    row.linkedRun?.track?.name?.trim() ||
    row.linkedRun?.trackNameSnapshot?.trim() ||
    null;
  const trackId = row.linkedEvent?.track?.id ?? row.linkedRun?.track?.id ?? null;

  const anchorRows = sets.find((s) => s.isPrimaryUser)?.laps ?? [];

  const title = importedSessionTitle({
    ...row,
    driverName: anchor.driverName,
    driverCount: ordered.length,
  });

  const run: CompareRunShape = {
    id: `import:${row.id}`,
    userId: null,
    createdAt: row.createdAt.toISOString(),
    sessionCompletedAt: row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null,
    sortAt: whenIso,
    sessionType: IMPORTED_SESSION_TYPE,
    sessionLabel: title,
    eventId: row.linkedEventId,
    event: row.linkedEvent ? { name: row.linkedEvent.name } : null,
    car: null,
    carId: null,
    carNameSnapshot: null,
    track: trackId && trackName ? { id: trackId, name: trackName } : null,
    trackNameSnapshot: trackName,
    lapTimes: anchorRows.map((l) => l.lapTimeSeconds),
    /*
     * The per-lap inclusion the auto-exclude just decided, in the shape
     * `primaryLapRowsFromRun` reads. Without it the anchor column would draw its marshal
     * lap while every rival column had theirs cut — the one comparison on the sheet that
     * would be measured differently from all the others.
     */
    lapSession: {
      version: 1,
      entries: [{ perLap: anchorRows.map((l) => ({ isIncluded: l.isIncluded })) }],
    },
    importedLapSets: sets,
    tireRunNumber: 0,
    setupSnapshot: null,
  };

  return {
    sessionId: row.id,
    title,
    sourceLabel:
      timingSourceFromParserId(row.parserId) ?? timingSourceFromSourceUrl(row.sourceUrl) ?? null,
    sourceUrl: row.sourceUrl,
    whenIso,
    trackName,
    driverCount: ordered.length,
    anchorDriverName: anchor.driverName,
    anchorIsViewer: mine != null,
    run,
  };
}
