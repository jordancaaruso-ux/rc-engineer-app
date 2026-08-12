"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Flag, TriangleAlert, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { SessionTrendCard } from "@/components/analysis/SessionTrendCardLazy";
import { RunPageClient } from "@/components/runs/RunPageClient";
import type { Run } from "@/components/runs/RunDetailPanel";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { WorkbenchGroup, WorkbenchRunRow } from "@/lib/runs/sessionWorkbenchModel";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";

/**
 * Sessions at lg+ — the archive on the left, one reading surface on the right.
 *
 * On a phone Sessions is a list you tap into, which is right: you scan, you pick,
 * the run takes the screen. A 1440px screen can hold both, so here the list keeps
 * its place and only the pane changes. Selecting a *session* reads the whole day
 * (the same `SessionTrendCard` /analysis renders); selecting a *run* reads that
 * run (the same `RunPageClient` /runs/[id] renders). Neither is a second
 * implementation — both are the shipped component, which is what stops the two
 * surfaces drifting.
 *
 * The signature here is the **selection spine**: a single accent rail down the
 * list's left edge that runs through the open session and brightens at the open
 * run, so "which day, which run" is one unbroken line rather than two highlights
 * competing for the same meaning.
 *
 * Below lg this renders nothing — the server page's `<details>` accordion owns
 * the phone, byte for byte as before.
 */

/** Selection lives in the URL so a pane is linkable; `g` = session group, `r` = run. */
const GROUP_PARAM = "g";
const RUN_PARAM = "r";

type Selection = { groupId: string; runId: string | null };

function readSelection(fallbackGroupId: string | null): Selection {
  if (typeof window === "undefined") return { groupId: fallbackGroupId ?? "", runId: null };
  const params = new URLSearchParams(window.location.search);
  return {
    groupId: params.get(GROUP_PARAM) ?? fallbackGroupId ?? "",
    runId: params.get(RUN_PARAM),
  };
}

export function SessionsWorkbench({
  groups,
  runs,
  pickerRuns,
  runListSource,
  displayTimeZone,
  userDisplayName,
  railFooter,
}: {
  groups: WorkbenchGroup[];
  /** Full run rows for the detail pane — the same array the table already receives. */
  runs: Run[];
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  displayTimeZone: string | null;
  userDisplayName: string | null;
  /**
   * "View more · N older runs". It belongs to the archive, not to the page, so it
   * rides at the end of the rail's own scroll rather than centred under all three
   * columns — you reach it by running out of sessions, which is when you want it.
   */
  railFooter?: ReactNode;
}) {
  const firstGroupId = groups[0]?.id ?? null;
  const [selection, setSelection] = useState<Selection>({
    groupId: firstGroupId ?? "",
    runId: null,
  });

  // Read the URL after mount so the server and first client render agree.
  useEffect(() => {
    setSelection(readSelection(firstGroupId));
  }, [firstGroupId]);

  // Back/forward should walk selections, not leave the page.
  useEffect(() => {
    const onPop = () => setSelection(readSelection(firstGroupId));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [firstGroupId]);

  const select = useCallback((next: Selection) => {
    setSelection(next);
    const params = new URLSearchParams(window.location.search);
    params.set(GROUP_PARAM, next.groupId);
    if (next.runId) params.set(RUN_PARAM, next.runId);
    else params.delete(RUN_PARAM);
    // pushState, not router.push — selection is client state, and a server round
    // trip per click would make the rail feel like a page navigation.
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, []);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === selection.groupId) ?? groups[0] ?? null,
    [groups, selection.groupId]
  );
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);
  const activeRun = selection.runId ? runsById.get(selection.runId) ?? null : null;

  // The trend chart's own tap target. Guarded: if the chart somehow offers a run
  // the pane can't render, fall back to the run page rather than selecting a run
  // that resolves to nothing and silently bouncing the reader back to the day.
  const activeGroupId = activeGroup?.id ?? null;
  const selectRunFromChart = useCallback(
    (runId: string) => {
      if (!activeGroupId) return;
      if (!runsById.has(runId)) {
        window.location.assign(`/runs/${encodeURIComponent(runId)}`);
        return;
      }
      select({ groupId: activeGroupId, runId });
    },
    [activeGroupId, runsById, select]
  );

  // A run id from the URL that isn't in this group (or was filtered away) must not
  // leave the pane blank — fall back to the day rather than showing nothing.
  const paneMode: "run" | "day" = activeRun ? "run" : "day";

  if (groups.length === 0) return null;

  return (
    <div
      className={cn(
        "hidden lg:grid lg:items-start lg:gap-4",
        // Two tracks up to 2xl, three from 1536 — see RUN_COLUMNS for why the
        // third one only appears when the middle can still afford 520px.
        "lg:grid-cols-[16.5rem_minmax(0,1fr)]",
        "2xl:grid-cols-[16.5rem_minmax(0,1fr)_19.5rem]"
      )}
    >
      {/* `sr-only` is absolutely positioned, so it never claims a track. */}
      <p aria-live="polite" className="sr-only">
        {paneMode === "run" && activeRun
          ? `Showing run detail${activeGroup ? ` in ${activeGroup.title}` : ""}.`
          : activeGroup
            ? `Showing the session trend for ${activeGroup.title}.`
            : ""}
      </p>

      <RailPanel
        groups={groups}
        selection={selection}
        activeGroupId={activeGroup?.id ?? null}
        onSelect={select}
        footer={railFooter}
      />

      {/* No title row in either mode. The rail names the open session — its
          title, date, track and run count are all in the header two inches to
          the left, and the highlighted row says which run — so a heading here
          repeated it and pushed both panes out of alignment. Reading a run,
          the card's own header line carries the back control and the actions. */}
      {paneMode === "run" && activeRun ? (
        /**
         * `2xl:contents` is what makes one component serve both layouts. Below
         * 2xl this is an ordinary grid item holding the record and the log
         * stacked in track 2; at 2xl the wrapper stops generating a box and its
         * two cards become grid items in their own right, landing in tracks 2
         * and 3. No duplicate render tree, no viewport JS, no hydration seam.
         *
         * `key` remounts on run change, which resets every column's scroll for
         * free — no ref, no imperative scrollTo.
         */
        <div
          key={activeRun.id}
          className={cn(RUN_COLUMNS.stack, "2xl:contents")}
        >
          <RunPageClient
            run={activeRun}
            pickerRuns={pickerRuns}
            runListSource={runListSource}
            displayTimeZone={displayTimeZone}
            allowRunMutations
            runOwnerDisplayName={userDisplayName}
            runOwnedByViewer
            placement="header"
            layout="split"
            columnClassName={RUN_COLUMNS.card}
            onBack={
              activeGroup ? () => select({ groupId: activeGroup.id, runId: null }) : undefined
            }
          />
        </div>
      ) : activeGroup?.trend ? (
        /* Day view has no run to put in the third track, so the chart takes it —
           the spread view has wanted that width since it shipped. */
        <section
          key={activeGroup.id}
          aria-label="Session trend"
          className={cn(RUN_COLUMNS.stack, "2xl:col-span-2")}
        >
          {/* Tapping a run on the chart selects it in the pane rather than
              navigating to /runs/<id>. The chart is a picker here — the day is
              on screen, and reading one of its runs shouldn't cost you the rail. */}
          <SessionTrendCard trend={activeGroup.trend} onSelectRun={selectRunFromChart} />
        </section>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 text-[13px] leading-relaxed text-muted-foreground 2xl:col-span-2">
          No lap times in this session yet. Pick a run to see its details, or ingest laps to
          chart the day.
        </div>
      )}
    </div>
  );
}

/**
 * The pane's two shapes.
 *
 * `stack` is the wrapper below 2xl — one scrolling column, capped to the same
 * height as the rail so the two agree. `card` is each column at 2xl, where the
 * wrapper has gone to `display: contents` and every track scrolls on its own.
 * The cap moves between them rather than being declared twice, so there is only
 * ever one scroller in play.
 */
/* Height literals, not interpolated — Tailwind extracts class names by scanning
   source text, so a template string would silently produce no CSS at all. */
const RUN_COLUMNS = {
  stack: cn(
    "flex min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
    "lg:max-h-[calc(100vh-11.5rem)] 2xl:max-h-none 2xl:overflow-visible",
    "motion-safe:animate-[rc-pane-in_180ms_ease-out]"
  ),
  card: cn(
    "min-w-0 2xl:max-h-[calc(100vh-11.5rem)]",
    "2xl:overflow-y-auto 2xl:overscroll-contain 2xl:[scrollbar-gutter:stable]"
  ),
};

/** The archive rail — sessions, each opening to its runs, with the spine down the edge. */
function RailPanel({
  groups,
  selection,
  activeGroupId,
  onSelect,
  footer,
}: {
  groups: WorkbenchGroup[];
  selection: Selection;
  activeGroupId: string | null;
  onSelect: (next: Selection) => void;
  footer?: ReactNode;
}) {
  return (
    <div
      role="listbox"
      aria-label="Sessions"
      // Demo walkthrough stop 3 on desktop. The phone's session list is the accordion card in
      // `app/runs/history/page.tsx`, which carries the same anchor id — only one of the two is
      // ever visible, and the tour resolves whichever that is.
      data-tour="sessions"
      className="overflow-y-auto overscroll-contain rounded-xl border border-border bg-card [scrollbar-gutter:stable] lg:max-h-[calc(100vh-11.5rem)]"
    >
      {groups.map((group, index) => {
        const open = group.id === activeGroupId;
        const isRaceMeeting = group.type === "Race Meeting";
        return (
          <div
            key={group.id}
            className={cn(
              // The spine: one rail down the open day, dim, with the open run
              // brightening a segment of it. Transparent otherwise so closed rows
              // keep a flush left edge.
              "border-l-2 transition-colors",
              open ? "border-primary-ink/30 bg-muted/25" : "border-transparent",
              index > 0 && "border-t border-t-border"
            )}
          >
            <button
              type="button"
              role="option"
              aria-selected={open && selection.runId == null}
              onClick={() => onSelect({ groupId: group.id, runId: null })}
              className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
            >
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
                  open
                    ? "border-ring/40 bg-muted text-foreground"
                    : "border-border bg-secondary text-muted-foreground"
                )}
                aria-hidden
              >
                {isRaceMeeting ? <Flag className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
              </span>
              {/* Date, track and run count on one truncating line. They used to
                  sit in two columns, which cost the title ~70px of the 264px rail
                  and still wrapped "5 runs" onto its own row. One line clips
                  gracefully; two columns fought each other. */}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-[13px] font-semibold leading-tight",
                    open ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {group.title}
                </span>
                <span className="mt-1 block truncate font-mono text-[10px] leading-none text-faint">
                  {group.dateLabel}
                  {group.trackName ? ` · ${group.trackName}` : ""} · {group.runs.length} run
                  {group.runs.length !== 1 ? "s" : ""}
                </span>
              </span>
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-faint transition-transform",
                  open && "rotate-90"
                )}
                aria-hidden
              />
            </button>

            {open ? (
              <RunRail
                runs={group.runs}
                selectedRunId={selection.runId}
                onSelect={(runId) => onSelect({ groupId: group.id, runId })}
              />
            ) : null}
          </div>
        );
      })}
      {footer ? <div className="border-t border-border px-3 py-2.5">{footer}</div> : null}
    </div>
  );
}

function RunRail({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: WorkbenchRunRow[];
  selectedRunId: string | null;
  onSelect: (runId: string | null) => void;
}) {
  const router = useRouter();
  // Selection can arrive from the chart, not just from this list — scroll the
  // chosen row into view so the spine never highlights something off-screen.
  // `block: "nearest"` is a no-op when the row is already visible, so clicking a
  // row directly doesn't make the rail jump under the pointer.
  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedRunId]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = index + (event.key === "ArrowDown" ? 1 : -1);
    const target = runs[next];
    if (!target) return;
    onSelect(target.id);
    const el = event.currentTarget.parentElement?.children[next] as HTMLElement | undefined;
    el?.focus();
  };

  return (
    <div className="pb-1.5">
      {runs.map((run, index) => {
        const active = run.id === selectedRunId;
        return (
          <div
            key={run.id}
            ref={active ? activeRef : undefined}
            role="option"
            tabIndex={0}
            aria-selected={active}
            // Neither this row nor the phone's table row is an <a>, so the demo walkthrough has
            // no href to read when it needs to open a run. This is that handle. Inert markup.
            data-run-id={run.id}
            onClick={() => onSelect(run.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(run.id);
                return;
              }
              onKeyDown(event, index);
            }}
            className={cn(
              // -ml-[2px] + its own left border continues the spine rather than
              // sitting inside it, so the rail reads as one line.
              "relative -ml-[2px] flex cursor-pointer items-baseline gap-2.5 border-l-2 py-1 pl-[2.375rem] pr-3 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
              active
                ? "border-primary-ink bg-muted text-foreground"
                : "border-transparent hover:bg-muted/40"
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[12px] font-semibold",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {run.label}
            </span>
            {run.needsLapImport ? (
              // At lg+ this rail IS Sessions (the accordion is lg:hidden), so the
              // mark has to be actionable here or the desktop has no way in.
              // `?step=laps` because firstUnfinishedStep would otherwise stop at
              // the first empty step, usually Prep.
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(`/runs/${run.id}/edit?step=laps`);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                aria-label={`Lap times missing on ${run.label} — import them`}
                title="No lap times on this run — tap to import"
                className="inline-flex shrink-0 items-center justify-center rounded border border-amber-500/40 bg-amber-500/10 p-0.5 text-amber-900 transition hover:bg-amber-500/20 dark:text-amber-100"
              >
                <TriangleAlert className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
            <span className="shrink-0 font-mono text-[9.5px] text-faint">{run.lapCount} laps</span>
            <span
              className={cn(
                // Gain green, matching every other "this is the fast one" mark in
                // the app. It's a CSS var, not a Tailwind colour — hence the literal.
                "shrink-0 font-mono text-[11px] tabular-nums",
                run.isGroupBest ? "text-gain" : "text-foreground"
              )}
              title={run.isGroupBest ? "Fastest lap of this session" : undefined}
            >
              {run.best != null ? formatLap(run.best) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
