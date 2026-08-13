import { formatRunSessionDisplay } from "@/lib/runSession";
import { chassisChangedKeys } from "@/lib/setup/runContextSetupKeys";

/**
 * Every setup this car can offer, in one list — "All setups" on the car page.
 *
 * ============================== WHY ONE LIST ==============================
 *
 * There used to be three places a setup could be: a "Saved setups" card, a "Baseline setups" card,
 * and a "Setup history" list of runs and uploaded sheets. Nothing on screen said how they related,
 * and the same setup could appear in two of them, so the founder could not answer "what setups does
 * this car have" without reading three cards and doing the joining himself (2026-08-11).
 *
 * So this builds ONE date-ordered list, and `kind` records where each row came from. The chips on
 * top filter it. Saved setups keep their own card as well — that card is the short list you reach
 * for, this is the full one you search.
 *
 * ============================== KIND vs SAVED ==============================
 *
 * They are two different facts and they get two different marks on screen:
 *
 *  - `kind` is WHERE IT CAME FROM, and never changes. A run's setup is always a run's setup.
 *  - `saved` is WHETHER YOU KEPT IT, and toggles. Saving a run's setup does not copy it — it flags
 *    the same row (founder call 2026-08-11: "mark it, one setup, two places"), which is why a saved
 *    run appears once here with its bookmark filled, not twice.
 *
 * `kind: "saved"` therefore means only "saved, with no run and no sheet behind it" — a setup built
 * from a blank sheet or copied off a baseline.
 *
 * ============================== WHAT EARNS A ROW ==============================
 *
 * Two rules keep the list readable (founder call 2026-07-22, still standing):
 *  - a run earns a row only when something outside `RUN_CONTEXT_SETUP_KEYS` changed, so picking
 *    tires or bumping additive time never reads as a setup change;
 *  - an uploaded sheet that produced a setup is *one* row — the setup, with the PDF hung off it.
 *
 * Pure on purpose: the DB reads live in `getCarSetupHistory.ts`.
 */

export type CarSetupHistoryKind = "run" | "sheet" | "baseline" | "saved";

export type CarSetupHistoryEntry = {
  /** Stable React key — snapshot id for setups, document id for sheets that made none. */
  id: string;
  kind: CarSetupHistoryKind;
  at: string;
  dateLabel: string;
  title: string;
  meta: string;
  /** Human labels for what changed. Empty for everything but runs. */
  changedLabels: string[];
  /**
   * Where the row opens, or null when there is nothing to open.
   *
   * Null only for baselines: they are global `BaselineSetup` rows, not snapshots, and the app has
   * no driver-facing page for one. A row that navigated nowhere would be worse than a row that
   * plainly doesn't — so those rows carry their action ("Save a copy") and no chevron.
   */
  href: string | null;
  /** In the driver's saved setups right now. Always false for baselines — they aren't yours. */
  saved: boolean;
  /**
   * How saving works for this row.
   *  - `mark`   — flip this very snapshot into the library, no copy (runs, sheets, saved rows)
   *  - `copy`   — a global baseline; taking it writes a new setup that is yours
   *  - `none`   — nothing to save yet (a sheet whose values could not be read)
   */
  saveAction: "mark" | "copy" | "none";
  /**
   * Locked to rename-only once saved: a run points at this exact snapshot, so editing the values
   * would change what that run says it ran. Start a new setup from it instead.
   */
  usedByRuns: number;
  /** Baselines only: the publisher's note, and the global row id the copy is taken from. */
  notes?: string | null;
  baselineId?: string;
};

/** How many rows each chip would show. A chip with none behind it is not offered. */
export type CarSetupCounts = {
  all: number;
  run: number;
  sheet: number;
  baseline: number;
  saved: number;
};

export type SetupHistoryRunInput = {
  id: string;
  createdAt: Date;
  sessionType: string;
  meetingSessionType: string | null;
  meetingSessionCode: string | null;
  sessionLabel: string | null;
  setupSnapshotId: string;
  track: { name: string } | null;
  event: { name: string } | null;
  setupSnapshot: {
    setupDeltaJson: unknown;
    baseSetupSnapshotId: string | null;
    isLibrary?: boolean;
    name?: string | null;
  } | null;
};

export type SetupHistoryDocumentInput = {
  id: string;
  originalFilename: string;
  createdAt: Date;
  parseStatus: string;
  createdSetupId: string | null;
  /** The setup this sheet produced, when it made one. */
  createdSetup?: { isLibrary: boolean; name: string | null; runCount: number } | null;
};

/** A saved setup with no run and no sheet behind it — built from a blank, or off a baseline. */
export type SetupHistoryLibraryInput = {
  id: string;
  name: string | null;
  createdAt: Date;
  valueCount: number;
  runCount: number;
  /** Where its numbers started, when a person chose to fork them. Shown as "Edited from …". */
  editedFrom?: string | null;
  /** A published baseline it was copied from. Shown as "Copied from …". */
  copiedFrom?: string | null;
};

export type SetupHistoryBaselineInput = {
  id: string;
  name: string;
  createdAt: Date;
  kindLabel: string;
  contextLabel: string | null;
  valueCount: number;
  notes: string | null;
};

function sheetTitle(filename: string): string {
  const withoutExt = filename.replace(/\.[a-z0-9]+$/i, "");
  return withoutExt.trim() || filename;
}

function sheetMeta(doc: SetupHistoryDocumentInput): string {
  if (doc.createdSetupId) return "Uploaded sheet";
  const status = doc.parseStatus.toLowerCase();
  if (status === "failed") return "Uploaded sheet · couldn’t be read";
  if (status === "parsed") return "Uploaded sheet · no setup created";
  return `Uploaded sheet · ${status} read, needs review`;
}

export function buildCarSetupHistory(input: {
  carId: string;
  runs: SetupHistoryRunInput[];
  documents: SetupHistoryDocumentInput[];
  /** Saved setups that no run and no sheet accounts for. */
  librarySetups?: SetupHistoryLibraryInput[];
  /** Published for this chassis. Global rows, so they can only ever be copied. */
  baselines?: SetupHistoryBaselineInput[];
  labelForKey: (key: string) => string;
  formatDate: (at: Date) => string;
}): CarSetupHistoryEntry[] {
  const entries: CarSetupHistoryEntry[] = [];

  for (const run of input.runs) {
    const snapshot = run.setupSnapshot;
    const changed = chassisChangedKeys(snapshot?.setupDeltaJson);
    // No baseline at all = the first setup recorded on this car, which is a change by definition.
    const isFirstSetup = !snapshot?.baseSetupSnapshotId;
    if (changed.length === 0 && !isFirstSetup) continue;

    const session = formatRunSessionDisplay(
      {
        sessionType: run.sessionType,
        meetingSessionType: run.meetingSessionType,
        meetingSessionCode: run.meetingSessionCode,
        sessionLabel: run.sessionLabel,
      },
      { fallback: "Testing run" }
    );
    const saved = Boolean(snapshot?.isLibrary);
    entries.push({
      id: run.setupSnapshotId,
      kind: "run",
      at: run.createdAt.toISOString(),
      dateLabel: input.formatDate(run.createdAt),
      // Once saved, the name the driver gave it wins: that is the name they will look for.
      title: saved && snapshot?.name ? snapshot.name : run.event?.name ? `${run.event.name} · ${session}` : session,
      meta:
        changed.length === 0 && isFirstSetup
          ? [run.track?.name, "first setup on this car"].filter(Boolean).join(" · ")
          : (run.track?.name ?? "No track"),
      changedLabels: changed.map(input.labelForKey),
      href: `/cars/${input.carId}/setups/${run.setupSnapshotId}`,
      saved,
      saveAction: "mark",
      usedByRuns: 1,
    });
  }

  for (const doc of input.documents) {
    const made = doc.createdSetup ?? null;
    entries.push({
      id: doc.createdSetupId ?? doc.id,
      kind: "sheet",
      at: doc.createdAt.toISOString(),
      dateLabel: input.formatDate(doc.createdAt),
      title: made?.isLibrary && made.name ? made.name : sheetTitle(doc.originalFilename),
      meta: sheetMeta(doc),
      changedLabels: [],
      href: doc.createdSetupId
        ? `/cars/${input.carId}/setups/${doc.createdSetupId}`
        : `/setup-documents/${doc.id}`,
      saved: Boolean(made?.isLibrary),
      // A sheet that read nothing has no setup to keep — the row is there to be fixed, not saved.
      saveAction: doc.createdSetupId ? "mark" : "none",
      usedByRuns: made?.runCount ?? 0,
    });
  }

  for (const lib of input.librarySetups ?? []) {
    entries.push({
      id: lib.id,
      kind: "saved",
      at: lib.createdAt.toISOString(),
      dateLabel: input.formatDate(lib.createdAt),
      title: lib.name ?? "Untitled setup",
      meta: [
        `${lib.valueCount} value${lib.valueCount === 1 ? "" : "s"}`,
        lib.copiedFrom
          ? `Copied from ${lib.copiedFrom}`
          : lib.editedFrom
            ? `Edited from ${lib.editedFrom}`
            : null,
      ]
        .filter(Boolean)
        .join(" · "),
      changedLabels: [],
      href: `/cars/${input.carId}/setups/${lib.id}`,
      saved: true,
      saveAction: "mark",
      usedByRuns: lib.runCount,
    });
  }

  for (const b of input.baselines ?? []) {
    entries.push({
      id: `baseline-${b.id}`,
      kind: "baseline",
      at: b.createdAt.toISOString(),
      dateLabel: input.formatDate(b.createdAt),
      title: b.name,
      meta: [b.kindLabel, `${b.valueCount} values`, b.contextLabel].filter(Boolean).join(" · "),
      changedLabels: [],
      // Opens read-only against this car: a global row can be read on your sheet, and copied from
      // there, but never edited in place. The row used to open nothing at all.
      href: `/cars/${input.carId}/baselines/${b.id}`,
      // Published globally, so there is nothing of yours to flag — taking one writes a copy.
      saved: false,
      saveAction: "copy",
      usedByRuns: 0,
      notes: b.notes,
      baselineId: b.id,
    });
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entries;
}

/** Row counts per chip, so a chip can say how much is behind it and hide when that is none. */
export function carSetupCounts(entries: readonly CarSetupHistoryEntry[]): CarSetupCounts {
  return {
    all: entries.length,
    run: entries.filter((e) => e.kind === "run").length,
    sheet: entries.filter((e) => e.kind === "sheet").length,
    baseline: entries.filter((e) => e.kind === "baseline").length,
    // Counts saved-ness, not kind: a saved run belongs under this chip too.
    saved: entries.filter((e) => e.saved).length,
  };
}
