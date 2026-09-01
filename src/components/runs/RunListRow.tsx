"use client";

import type { ReactNode } from "react";
import { ChevronRight, TriangleAlert, Wrench } from "lucide-react";
import type { WorkbenchRunRow } from "@/lib/runs/sessionWorkbenchModel";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";

/**
 * One run in a day's list — the row `/analysis` and the Sessions day screen both draw.
 *
 *     ┌────────────────────────────────────────────────┐
 *     │ Practice · A800RR  BEST              15.802    │
 *     │ TFTR · 19 Jul, 4:18 PM            med 16.204 🔧 › │
 *     └────────────────────────────────────────────────┘
 *
 * ## Why it is one component (2026-08-26)
 *
 * It was two, and they had already drifted: the same run wore a 52/50 figure pair
 * under a tinted column strip on Sessions and a bare one on `/analysis`, the wrench
 * arrived on one list a day before the other, and each carried its own copy of the
 * open / pointed-at rail rules. The two lists share `RunFaces` for what opens
 * *inside* a row precisely so they cannot disagree about a run; the row above it was
 * the half still free to.
 *
 * ## The figures stack, so no column strip exists
 *
 * Best rides big with the median small beneath it, labelled in place — `med 16.123`.
 * That kills the Run / Best / Top 10 header band on both surfaces: a strip naming
 * columns is only worth its row when the figures under it can't name themselves.
 * (Founder call, 2026-08-26, from a screenshot of this exact shape.)
 *
 * **Median, not Top 10.** `avgTop10` is null unless a run actually holds ten clean
 * laps, so the old column printed an em dash on every short run — the figure most
 * likely to be missing sat next to the one that never is. The median is defined
 * whenever there are laps at all, and it answers the same question the second figure
 * was there to answer: was the hot lap a fluke or the shape of the run?
 *
 * ## BEST is a pill, not a coloured number
 *
 * The fastest lap of the outing used to tint its figure green. Green on a figure
 * reads as a delta — the app's own rule is that green and red mean pace moved — and
 * this is not a delta, it is a rosette. So the number stays ink and the claim becomes
 * a word beside the run's name, where a verdict belongs.
 *
 * It says BEST rather than PB deliberately: `isGroupBest` means fastest lap of THIS
 * day, and the app has no lifetime-best test on this path. A pill claiming a personal
 * best on a slow day at a slow track would be a lie in mint.
 */
export function RunListRow({
  row,
  open,
  focused = false,
  hasRecord,
  onOpen,
  onOpenSetup,
  domId,
  children,
}: {
  row: WorkbenchRunRow;
  /** The row is unfolded — outranks `focused`, which is only a pointer. */
  open: boolean;
  /** Under the pointer on the chart above. A weaker mark, on purpose. */
  focused?: boolean;
  /**
   * The page loaded this run's full record, so the row can unfold in place. False on
   * a list that names more runs than it fetched (a teammate's day); the host decides
   * what a tap does instead — it never opens onto nothing.
   */
  hasRecord: boolean;
  onOpen: () => void;
  onOpenSetup: () => void;
  /** DOM id for a host that scrolls to a row by anchor (the Sessions day screen). */
  domId?: string;
  /** The expansion — `RunFaces`, mounted by the host only while `open`. */
  children?: ReactNode;
}) {
  return (
    <div
      id={domId}
      data-run-row={row.id}
      className={cn(
        "scroll-mt-16 border-b border-l-2 border-border last:border-b-0",
        // Hover belongs to the whole row, not to whichever of its three controls the
        // pointer is over — painted per button, the fill stopped at the wrench and one
        // row read as two.
        "transition-colors hover:bg-muted/40",
        /*
          Three states, and the order is the ranking. OPEN outranks pointed-at: a day
          can carry several of both, and the one you unfolded is the one you are
          reading. Pointed-at is deliberately the weaker mark — a dim spine over the
          same fill — so a row you are sweeping past on the chart can never be mistaken
          for a row that is open.
        */
        open
          ? "border-l-primary bg-muted/40"
          : focused
            ? "border-l-primary-ink/40 bg-muted/40"
            : "border-l-transparent"
      )}
    >
      {/*
        Three buttons side by side, NOT buttons inside a button — the row opens, the
        wrench goes to its setup, the chevron is a second target for the first. Nesting
        them is invalid HTML that the browser fixes by hoisting the inner one out,
        breaking the row's own tap target on the way.
      */}
      <div className="flex items-stretch pr-1">
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={hasRecord ? open : undefined}
          className={cn(
            "group tap-active flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-1 text-left transition-colors",
            "active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[14px] font-semibold leading-tight tracking-tight text-foreground">
                {row.title}
              </span>
              {row.isGroupBest ? (
                <span className="shrink-0 rounded-full bg-gain/12 px-2 py-[2px] text-[9px] font-bold uppercase tracking-[0.07em] text-gain">
                  Best
                </span>
              ) : null}
            </span>
            {/*
              Where, then when — "TFTR · 19 Jul, 4:48 PM" (founder's format, 2026-08-26).
              The date earns its place beside the clock even on a list of one day: this
              row is drawn on `/analysis`, on the Sessions day screen and, one day, on
              any list that holds runs from more than one, and a line that only says
              "4:48 PM" is unreadable the moment the list is not a single day.

              The lap count came off with the same call — it never decided anything a
              driver was about to do, and it was the third fact on a line that only has
              room to be scanned.
            */}
            <span className="truncate text-[11.5px] leading-none text-faint">
              {row.whereLabel ? `${row.whereLabel} · ` : ""}
              <span className="tabular-nums">{row.whenLabel}</span>
            </span>
          </span>
          {row.needsLapImport ? (
            <TriangleAlert
              className="h-4 w-4 shrink-0 text-warning"
              aria-label="No lap times on this run"
            />
          ) : null}
          {/* The pair. Right-aligned and tabular so the decimal points land on one x
              down the whole list — the only reason these figures sit out here rather
              than inside the run.

              15px SEMIBOLD, which is not a taste but a copy: it is exactly the recipe
              the pinned Best / Top 5 / Top 10 strip uses inside an opened run
              (`Figure` in `RunFaces`). Built at 17px bold this row shouted louder than
              the run it opens into — founder, 2026-08-26: "too bold, it looks
              cartoony". A collapsed row and an open one are the same number about the
              same run, so they state it the same way. If that strip's size ever
              moves, this moves with it. */}
          <span className="shrink-0 text-right">
            <span className="block text-[15px] font-semibold leading-tight tracking-tight tabular-nums text-foreground">
              {row.best != null ? formatLap(row.best) : "—"}
            </span>
            <span className="block text-[10.5px] leading-tight tabular-nums text-faint">
              {row.median != null ? `med ${formatLap(row.median)}` : "no laps"}
            </span>
          </span>
        </button>
        {/*
          The setup sheet, one tap from the row — the door the phone lost when the
          chart's wrench gutter came off.

          It IS a button and it has to look like one (founder call, 2026-08-26). It
          spent a few hours borderless, on the reasoning that a box beside a chevron
          reads as two competing controls — but drained to faint ink it read as a
          second arrow instead, which is worse: a door that looks like decoration is a
          door nobody opens. So it wears the app's plain secondary recipe, hairline and
          inset fill, and the chevron beside it stays bare ink. One of them is a
          control, the other is a hint, and now they look it.
        */}
        <button
          type="button"
          onClick={onOpenSetup}
          aria-label={`View setup sheet for ${row.title}`}
          title="View setup sheet for this run"
          className={cn(
            "tap-active my-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border",
            "bg-secondary text-foreground transition-colors",
            "hover:border-ring/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          )}
        >
          <Wrench className="h-[15px] w-[15px]" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpen}
          tabIndex={-1}
          aria-hidden
          className="tap-active group grid w-6 shrink-0 place-items-center transition-colors"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-faint transition-all group-hover:text-foreground group-active:text-foreground",
              open
                ? "rotate-90 text-foreground"
                : "group-hover:translate-x-0.5 group-active:translate-x-0.5"
            )}
            aria-hidden
          />
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * The seam in a list that has more rows behind it — "⌄ 2 more", centred on the
 * hairline that would otherwise just end the list.
 *
 * It was a full-width row carrying its own chevron at the far right, which is the
 * shape of the door directly beneath it ("View all 178 runs") — so *three more rows
 * of this day* and *every day you have ever raced* arrived at the same width, height
 * and weight (founder call, 2026-08-26). Unfolding rows already on screen is the
 * smallest thing this card does, and now it looks like it.
 */
export function MoreRunsSeam({
  hidden,
  showAll,
  onToggle,
}: {
  /** How many rows are behind the seam. */
  hidden: number;
  showAll: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative py-3">
      <span className="pointer-events-none absolute inset-x-4 top-1/2 block h-px bg-border" aria-hidden />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={showAll}
        className={cn(
          "tap-active relative mx-auto flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1",
          "text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors",
          "hover:border-ring/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        )}
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 transition-transform", showAll ? "-rotate-90" : "rotate-90")}
          aria-hidden
        />
        {showAll ? "Show fewer" : `${hidden} more`}
      </button>
    </div>
  );
}
