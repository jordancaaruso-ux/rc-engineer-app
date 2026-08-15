import { formatRunSessionDisplay } from "@/lib/runSession";
import { setupChangedRowsSincePrevious } from "@/lib/setupCompare/changedSincePrevious";
import { isRunToRunSetupNoiseKey } from "@/lib/setupCompare/setupChangeNoise";
import { savedRunSetupName } from "@/lib/setup/setupSaveName";

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
 * **A run earns a row unless its setup values are identical to the previous run's on this car.**
 * One rule, no exceptions — the first run on a car has no previous run, so it differs, so it gets a
 * row like any other (founder call 2026-08-15: "setups are living, you don't need a base; reference
 * a setup to a run for every run, unless it remains identical in consecutive runs").
 *
 * The comparison chain is RUNS ONLY, and it compares stored VALUES:
 *
 *  - Sheets, saved setups and baselines never suppress a run row. Uploading a sheet and then driving
 *    it unchanged shows both rows, because "I uploaded this" and "the car ran this" are different
 *    facts. They still get their own rows in the list; they are just not links in the chain.
 *  - The previous run is the one before it by `sortAt` — the app's stable ordering axis — so a
 *    re-imported or reordered run diffs against the run that actually preceded it on track.
 *  - `SetupSnapshot.setupDeltaJson` is NOT consulted. It records the diff against whatever setup the
 *    wizard happened to load, which answers a different question: load a saved setup from three
 *    weeks ago and change nothing and that delta is empty, while the car changed completely since
 *    the last run. That run used to vanish from this list. Now it doesn't.
 *  - Tires, additive, prep booleans and sheet-header fields are filtered out
 *    (`isRunToRunSetupNoiseKey`), so picking today's rubber is never a setup change — founder call
 *    2026-07-22, still standing.
 *  - Circling back to an old setup after three days of tweaking IS a change, because it differs from
 *    the run before it. The list never looks further back than one run.
 *
 * An uploaded sheet that produced a setup stays *one* row — the setup, with the PDF hung off it.
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
  /**
   * Clock time under the date ("2:41 PM"). Runs only — a sheet's upload time answers nothing, and
   * five runs on one day at one track are otherwise the same row five times over.
   */
  timeLabel: string | null;
  title: string;
  meta: string;
  /**
   * The run's best lap, for the right-hand column. Runs only, and null when the run has no laps —
   * or when `Run.bestLapSeconds` has not been materialised. Read straight off the column: the lap
   * rows are not fetched here, so nothing recomputes a missing one (see `getCarSetupHistory`).
   */
  bestLapSeconds: number | null;
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
  /** Ordering axis (`Run.sortAt`) — also what places the row in the merged date list. */
  sortAt: Date;
  /** Wallclock to show, from `resolveRunDisplayInstant`. Never `sortAt`: a drag must not relabel. */
  displayAt: Date;
  sessionType: string;
  meetingSessionType: string | null;
  meetingSessionCode: string | null;
  sessionLabel: string | null;
  setupSnapshotId: string;
  track: { name: string } | null;
  event: { name: string } | null;
  setupSnapshot: {
    /** The resolved values this run ran. The diff is computed from these, not from a stored delta. */
    data: unknown;
    isLibrary?: boolean;
    name?: string | null;
  } | null;
  /** `Run.bestLapSeconds` as stored. Null when the run has no laps, or the cache is stale. */
  bestLapSeconds?: number | null;
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

/**
 * Setup fields that moved between two runs, with everything the run form writes by itself removed.
 * Exported so `getCarSetupHistory` can label the "current setup" card with the same rule.
 */
export function runToRunChangedKeys(current: unknown, previous: unknown): string[] {
  return setupChangedRowsSincePrevious(current, previous)
    .filter((row) => !isRunToRunSetupNoiseKey(row.key))
    .map((row) => row.key);
}

/**
 * Which run of its day each run is — "Run 3" — keyed by run id.
 *
 * It counts EVERY run in the window, not just the ones that earn a row. Runs 3 and 4 changed
 * nothing, so they have no rows, and the row after them still has to read "Run 5": that is the
 * number on the driver's own timing sheet, and a row saying "Run 3" for the fifth run out would be
 * a lie that looks tidy. The visible numbers therefore have gaps, and the gaps are true.
 *
 * The day comes from `displayAt`, so it agrees with the date printed beside it; the order within
 * the day is the incoming `sortAt` order (newest first), so the count runs backwards.
 *
 * KNOWN EDGE: the window is the last 60 runs. If that cutoff lands mid-day, the oldest visible run
 * of that day is numbered 1 when it was really the 4th out. Only reachable on a car with more than
 * 60 runs, and only on the last row or two of the list.
 */
function dayRunNumbers(
  runs: readonly SetupHistoryRunInput[],
  dayKey: (at: Date) => string
): Map<string, number> {
  const perDay = new Map<string, number>();
  for (const r of runs) {
    const key = dayKey(r.displayAt);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const numbers = new Map<string, number>();
  const walked = new Map<string, number>();
  for (const r of runs) {
    const key = dayKey(r.displayAt);
    const used = walked.get(key) ?? 0;
    numbers.set(r.id, (perDay.get(key) ?? 0) - used);
    walked.set(key, used + 1);
  }
  return numbers;
}

export function buildCarSetupHistory(input: {
  carId: string;
  /** Newest first, by `sortAt`. The order is load-bearing: run `i + 1` is run `i`'s baseline. */
  runs: SetupHistoryRunInput[];
  documents: SetupHistoryDocumentInput[];
  /**
   * The setup of the run immediately before the OLDEST run in `runs`, when the read window stopped
   * short of the car's first run. Null/absent means `runs` reaches the beginning of the history.
   *
   * Without it the oldest run on screen has nothing to diff against and would report as a change on
   * every single page load — a row that appears only because the window ended there.
   */
  setupBeforeOldestRun?: unknown | null;
  /** Saved setups that no run and no sheet accounts for. */
  librarySetups?: SetupHistoryLibraryInput[];
  /** Published for this chassis. Global rows, so they can only ever be copied. */
  baselines?: SetupHistoryBaselineInput[];
  labelForKey: (key: string) => string;
  formatDate: (at: Date) => string;
  /** Clock time under the date, runs only. Omitted and the rows carry no time. */
  formatTime?: (at: Date) => string;
  /**
   * Calendar day of an instant in the driver's timezone. Omitted and no run is numbered — an
   * unlabeled testing run falls back to "Testing run" as it always did.
   */
  dayKey?: (at: Date) => string;
}): CarSetupHistoryEntry[] {
  const entries: CarSetupHistoryEntry[] = [];
  const runNumbers = input.dayKey ? dayRunNumbers(input.runs, input.dayKey) : null;

  for (let i = 0; i < input.runs.length; i += 1) {
    const run = input.runs[i];
    const snapshot = run.setupSnapshot;

    /*
     * The run before this one. Inside the window it is simply the next element (the list is newest
     * first); at the oldest element it is the anchor the caller fetched beyond the window. `null`
     * there means there is no earlier run at all — this is the car's first, and it earns a row with
     * nothing to compare against rather than a row claiming every field changed.
     */
    const previousSetup =
      i + 1 < input.runs.length
        ? (input.runs[i + 1].setupSnapshot?.data ?? null)
        : (input.setupBeforeOldestRun ?? null);

    const changed =
      previousSetup == null ? null : runToRunChangedKeys(snapshot?.data, previousSetup);
    // Identical to the run before it — the same setup twice is not two setups.
    if (changed != null && changed.length === 0) continue;

    /*
     * A run that named itself keeps its name — "Qualifying · Q2" says more than "Run 5" ever could,
     * and `formatRunSessionDisplay` only reaches for the number when there is nothing else to say.
     * So the number appears exactly where the row used to read "Testing run".
     */
    const session = formatRunSessionDisplay(
      {
        sessionType: run.sessionType,
        meetingSessionType: run.meetingSessionType,
        meetingSessionCode: run.meetingSessionCode,
        sessionLabel: run.sessionLabel,
      },
      { dayRunNumber: runNumbers?.get(run.id) ?? null, fallback: "Testing run" }
    );
    const saved = Boolean(snapshot?.isLibrary);
    entries.push({
      id: run.setupSnapshotId,
      kind: "run",
      at: run.sortAt.toISOString(),
      dateLabel: input.formatDate(run.displayAt),
      timeLabel: input.formatTime ? input.formatTime(run.displayAt) : null,
      bestLapSeconds: run.bestLapSeconds ?? null,
      // Once saved, the name the driver gave it wins: that is the name they will look for.
      title:
        saved && snapshot?.name
          ? snapshot.name
          : savedRunSetupName({ eventName: run.event?.name, sessionDisplay: session }),
      meta: run.track?.name ?? "No track",
      // Empty for the car's first run: there is no earlier run, so nothing "changed" — the row is
      // the setup itself, not a diff.
      changedLabels: (changed ?? []).map(input.labelForKey),
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
      // The hour a PDF was uploaded says nothing about the car, and no sheet has a lap time.
      timeLabel: null,
      bestLapSeconds: null,
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
      timeLabel: null,
      bestLapSeconds: null,
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
      timeLabel: null,
      bestLapSeconds: null,
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
