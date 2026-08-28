"use client";

import { useCallback, useState } from "react";
import { History } from "lucide-react";
import type { Run } from "@/components/runs/RunDetailPanel";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { WorkbenchRunRow } from "@/lib/runs/sessionWorkbenchModel";
import type { AnalysisTrendModel } from "@/lib/analysis/analysisHomeModel";
import { SessionTrendCard } from "@/components/analysis/SessionTrendCardLazy";
import { RunFaces } from "@/components/runs/RunFaces";
import { RunListRow, MoreRunsSeam } from "@/components/runs/RunListRow";
import { requestRunSetupExit } from "@/components/runs/runSetupEditGuard";
import { CardPanel } from "@/components/ui/CardPanel";
import { BandFoot } from "@/components/paddock/BandFoot";
import { OutingHeading } from "@/components/runs/OutingHeading";

/**
 * Your last time at the track, on `/analysis` (2026-08-25).
 *
 * The page used to open with three "recent runs" taken from wherever they fell —
 * three rows from three different weekends, none of which said which day it was
 * looking at. This block names the outing instead: the meeting or the track, the
 * date, and its runs newest-first under the chart that draws them.
 *
 * ## Three, then the rest
 *
 * Three rows is what fits above the teammates card without pushing it off a 390px
 * screen. The seam under them unfolds the rest of the day IN PLACE — it is never a
 * door to another page, because the whole point is that this page holds the outing.
 *
 * ## Rows open, they don't navigate
 *
 * Tapping a row unfolds `RunFaces` — the same component the Sessions day view opens,
 * so the two surfaces cannot drift. Nothing here points at `/runs/[id]`; that URL
 * survives as an address for shared links and notifications, not as a destination.
 *
 * Nothing is open when the page loads: a day is a list until you ask for a run.
 *
 * ## Two cards, one component (2026-08-26)
 *
 * The pace and the runs sit in a card each — the founder's call, and the shape the
 * Sessions day screen had already been shipping for two days. They stay in ONE
 * component because the state they share is the whole point (see below): a picture
 * in one box and a list in another that cannot point at each other is what this card
 * was built to stop.
 *
 * ## The chart is part of this component, not a picture handed to it
 *
 * Until 2026-08-25 the page built `SessionTrendCard` and passed it down as a
 * finished `chart` node. That made the two halves unable to speak:
 * pointing at a run on the plot left the list of those same runs sitting still,
 * and tapping a point fell through to the chart's default and NAVIGATED to
 * `/runs/<id>` — off the page whose whole promise is that a run opens in place.
 * One run answered two different ways depending on where your thumb landed.
 *
 * The card owns the chart now and holds the state both halves read:
 *
 * - pointing at the plot lights the matching row (`focusedRunId`, a weaker mark
 *   than open — the pattern is `SessionsBrowser`'s, and the two must not drift);
 * - tapping a point OPENS that run's row here, unfolding the day first if the run
 *   was behind the fold, then scrolling it up;
 * - opening a row marks its column on the plot (`markedRunId`), which is the leg
 *   that never existed — Sessions can't do it either.
 */

/** Rows visible before the chevron. See the file note — this is a fold budget, not a taste. */
const ROWS_SHOWN = 3;

export function AnalysisOutingCard({
  title,
  where,
  rows,
  runsById,
  displayTimeZone,
  outingTimeZone,
  pickerRuns,
  totalRunCount,
  hasTeam,
  trend,
}: {
  title: string;
  where: string;
  /** Newest-first, from `loadAnalysisOuting`. */
  rows: WorkbenchRunRow[];
  /** Full records for the rows that open. A row missing here still reads, it just can't unfold. */
  runsById: Map<string, Run>;
  displayTimeZone: string | null;
  /** The outing's resolved clock — see `loadAnalysisOuting`. */
  outingTimeZone: string;
  pickerRuns: CompareRunShape[];
  totalRunCount: number;
  hasTeam: boolean;
  /**
   * The day's pace, drawn bare and compact so it sits INSIDE this card rather than
   * in a box of its own. Passed as data, not as a rendered node — see the file note.
   */
  trend: AnalysisTrendModel | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const [openRunIds, setOpenRunIds] = useState<Set<string>>(new Set());
  /** Under the pointer on the plot. Momentary, and never a selection. */
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  /**
   * The run the PLOT marks — the last one you opened, not every open one.
   *
   * A day can have several rows unfolded at once, and a plot cannot mark several
   * columns without becoming a mess of rules. The most recent one is the one you
   * are reading, so that is the one the chart points at; closing it hands the mark
   * back to whatever is still open, or to nothing.
   */
  const [markedRunId, setMarkedRunId] = useState<string | null>(null);

  /**
   * Folding a row away UNMOUNTS whatever it was holding, and since 2026-08-25 that can be a setup
   * sheet with unsaved corrections typed into it. This card has no business knowing what a setup
   * is, so the open row registers the question and this asks it — see `runSetupEditGuard`. A row
   * with nothing at stake answers false and folds exactly as before.
   */
  const toggleRun = useCallback(
    (id: string) => {
      const collapse = () =>
        setOpenRunIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          setMarkedRunId([...next].pop() ?? null);
          return next;
        });
      if (openRunIds.has(id)) {
        if (requestRunSetupExit(id, collapse)) return;
        collapse();
        return;
      }
      setOpenRunIds((prev) => {
        const next = new Set(prev).add(id);
        setMarkedRunId(id);
        return next;
      });
    },
    [openRunIds]
  );

  /**
   * The wrench on a row: open the run ON its Setup face, which is where the sheet is drawn.
   *
   * The nonce is what makes a SECOND tap work. A driver who opened a row on Setup, read the laps,
   * then reached for the wrench again is asking for the sheet back; without a counter that ask is
   * indistinguishable from the state already stored and nothing would move. Same mechanism, same
   * words, as `SessionsBrowser` — the two lists share `RunFaces` so they cannot drift.
   */
  const [setupFocus, setSetupFocus] = useState<{ runId: string; nonce: number } | null>(null);
  const openRunOnSetup = useCallback((runId: string) => {
    setShowAll(true);
    setOpenRunIds((prev) => (prev.has(runId) ? prev : new Set(prev).add(runId)));
    setMarkedRunId(runId);
    setSetupFocus((prev) => ({ runId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  /**
   * Tapping a point on the plot. Opens the run HERE — this card is the run's home
   * on this page — unfolding the rest of the day first if the run you picked was
   * behind the fold, or the tap would appear to do nothing at all.
   *
   * The scroll waits a frame: the row has to grow before there is anything to
   * scroll to, and `block: "nearest"` keeps a row that is already on screen still.
   */
  const openFromChart = useCallback((runId: string) => {
    setShowAll(true);
    setOpenRunIds((prev) => (prev.has(runId) ? prev : new Set(prev).add(runId)));
    setMarkedRunId(runId);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-run-row="${CSS.escape(runId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  const visible = showAll ? rows : rows.slice(0, ROWS_SHOWN);
  const hidden = rows.length - visible.length;

  return (
    /*
      TWO cards, not one (founder call, 2026-08-26): the day's pace, then the day's
      runs. It was one tall panel that changed subject three times without ever
      changing surface — a heading, a picture, a column strip, a list, a disclosure
      and a door, all sharing one box.

      The split is also the end of a drift: the Sessions day screen has drawn exactly
      this pair since 2026-08-24, and `/analysis` is the surface that never got it.
      Both lists now draw their rows with `RunListRow` for the same reason they
      already share `RunFaces` — one run, one row, wherever you meet it.
    */
    <div className="flex flex-col gap-3">
      {/*
        The picture of the day, under the day's own name — "TFTR testing", not "Last
        time out". (Founder call, 2026-08-25: a label saying which card this is, above
        a name saying which day it is, spends a whole row to introduce the row beneath
        it. The page has one outing on it; the only question worth a heading is
        *which*.) Without the name the chart read as four generic grey lines.

        Nothing hangs under the plot: the run's tyre and setup marks ride the key line
        above it now (2026-08-26). See `SeriesKeyRow`'s `dense`.
      */}
      {trend ? (
        <CardPanel contentClassName="flex flex-col gap-0 p-0">
          <OutingHeading title={title} where={where} className="mx-4 mb-1.5 mt-3" />
          <SessionTrendCard
            trend={trend}
            compact
            bare
            onFocusRun={setFocusedRunId}
            onSelectRun={openFromChart}
            markedRunId={markedRunId}
          />
        </CardPanel>
      ) : null}

      <CardPanel contentClassName="flex flex-col gap-0 p-0">
        {/* A day whose runs carry no lap times draws no chart, so the heading has
            nowhere else to live and takes the top of this card instead. */}
        {trend ? null : <OutingHeading title={title} where={where} className="mx-4 mb-1.5 mt-3" />}

        {/*
          No column strip over these rows since 2026-08-26. It named "Run / Best /
          Top 10" for figures that now name themselves — best big, `med 16.123` small
          beneath it — and a strip introducing labelled figures is a row spent saying
          what the row below it already says. The list opens straight onto a run.
        */}
        <div>
          {visible.map((row) => {
            const record = runsById.get(row.id) ?? null;
            const open = openRunIds.has(row.id);
            return (
              <RunListRow
                key={row.id}
                row={row}
                open={open}
                focused={row.id === focusedRunId}
                hasRecord={record != null}
                onOpen={() => (record ? toggleRun(row.id) : undefined)}
                onOpenSetup={() => (record ? openRunOnSetup(row.id) : undefined)}
              >
                {record && open ? (
                  <RunFaces
                    run={record}
                    setupDiff={row.setupDiff}
                    displayTimeZone={displayTimeZone}
                    // The outing's own clock, so the run's "When" line and the row
                    // above it can never state two different times for one run.
                    runTimeZone={outingTimeZone}
                    // Always your own runs on this page — it reads one user's outing.
                    allowRunMutations
                    pickerRuns={pickerRuns}
                    runListSource="my_runs"
                    openFace={
                      setupFocus?.runId === row.id
                        ? { face: "setup", nonce: setupFocus.nonce }
                        : null
                    }
                  />
                ) : null}
              </RunListRow>
            );
          })}
        </div>

        {/*
          The seam, not a row (2026-08-26).

          It was a full-width row with its chevron at the far right — the shape of the
          door directly beneath it — so "three more rows of this day" and "every day
          you have ever raced" arrived at the same width, height and ink. Unfolding
          rows already on screen is the smallest thing this card does. See
          `MoreRunsSeam`.
        */}
        {rows.length > ROWS_SHOWN ? (
          <MoreRunsSeam hidden={hidden} showAll={showAll} onToggle={() => setShowAll((v) => !v)} />
        ) : null}

        {/*
          The one door out. Same foot as every Paddock band: the paper row explains
          what is through it, the yellow button acts and carries the count. `runs`,
          never "N sessions" — Sessions groups runs by day and meeting, so the two are
          different numbers.
        */}
        <BandFoot
          href="/runs/history"
          icon={History}
          title="All your sessions"
          detail={hasTeam ? "Grouped by day · filter, compare, team sessions" : "Grouped by day · filter and compare"}
          action={`View all ${totalRunCount} run${totalRunCount === 1 ? "" : "s"}`}
        />
      </CardPanel>
    </div>
  );
}
