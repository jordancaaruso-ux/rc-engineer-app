"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Flag, TriangleAlert, Wrench } from "lucide-react";
import { SessionTrendCard } from "@/components/analysis/SessionTrendCardLazy";
import { TeamDayCard } from "@/components/runs/TeamDayCard";
import { RunPageClient } from "@/components/runs/RunPageClient";
import type { Run } from "@/components/runs/RunDetailPanel";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { AnalysisTrendModel } from "@/lib/analysis/analysisHomeModel";
import type {
  WorkbenchDriver,
  WorkbenchGroup,
  WorkbenchGroupHeadline,
  WorkbenchRunRow,
} from "@/lib/runs/sessionWorkbenchModel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { useRegisterMobileBack } from "@/components/layout/MobileBackContext";
import { BACK_PARAM } from "@/lib/runs/sessionsReturn";
import { lapImportHref } from "@/lib/runs/lapImportHref";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";

/**
 * Sessions — one state, two foldings.
 *
 * There is exactly one thing being chosen here: a session, then (in team scope) a
 * driver, then a run. A 1440px screen can hold the list AND what it points at, so
 * at lg+ the list keeps its place on the left and only the pane changes. A phone
 * can hold one of them, so below lg the same selection renders as a push stack —
 * whichever level is deepest takes the screen, with a back control above it.
 *
 * Both foldings come out of one React tree and one piece of state. No viewport
 * JS, no second DOM, no hydration seam: the rail hides on a phone once something
 * is selected, and the pane hides on a phone while nothing is. That is the whole
 * mechanism, and it is why the phone and the desktop cannot drift.
 *
 * ## The three levels
 *
 * - **Session** — a day or an event. Always the list.
 * - **Driver** — team scope only, because solo's roster is one. Inserted between.
 * - **Run** — `RunPageClient` in the pane on desktop; on a phone, a real
 *   navigation to `/runs/[id]`, which is the page that already exists.
 *
 * Solo's *day* screen and team's *driver* screen are the same component with the
 * same props ({@link OneSession}). That identity is the point of the design: a
 * teammate's session reads exactly like your own because it IS your own screen.
 *
 * ## What replaced what
 *
 * This deletes the `<details>` accordion, `.sessions-split` (the CSS that
 * absolutely positioned every open session's pane into one shared column, which
 * is what stacked team days on top of each other) and `SessionsDesktopMasterDetail`
 * (25 lines of capture-phase JS whose only job was stopping that stacking).
 */

/** Selection lives in the URL so every level is linkable and the back gesture works. */
const GROUP_PARAM = "g";
const DRIVER_PARAM = "driver";
const RUN_PARAM = "r";

type Selection = { groupId: string | null; driverId: string | null; runId: string | null };

const EMPTY: Selection = { groupId: null, driverId: null, runId: null };

function readSelection(): Selection {
  if (typeof window === "undefined") return EMPTY;
  const params = new URLSearchParams(window.location.search);
  return {
    groupId: params.get(GROUP_PARAM),
    driverId: params.get(DRIVER_PARAM),
    runId: params.get(RUN_PARAM),
  };
}

/** True on the layout that shows rail and pane at once. Read at click time, never at render. */
function isSplitLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

export function SessionsBrowser({
  groups,
  runs,
  pickerRuns,
  runListSource,
  displayTimeZone,
  userDisplayName,
  memberDisplayByUserId,
  viewerUserId,
  teamMode,
  teamTitle,
  teamId,
  filtersActive = false,
  filterLabels = [],
  railFooter,
  initialGroupId,
  initialRunId,
}: {
  groups: WorkbenchGroup[];
  /** Full run rows for the detail pane — the same array the flat table receives. */
  runs: Run[];
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  displayTimeZone: string | null;
  userDisplayName: string | null;
  /** Team scope: how each driver is named. Empty in solo scope. */
  memberDisplayByUserId: Record<string, string>;
  viewerUserId: string;
  teamMode: boolean;
  teamTitle: string | null;
  /** Team scope only — carried so the mobile back href keeps the scope. */
  teamId?: string | null;
  /** Any filter is on, so every session here is a subset. Drives the landing and the ribbon. */
  filtersActive?: boolean;
  filterLabels?: string[];
  /**
   * "View more · N older runs". It belongs to the archive, not to the page, so it
   * rides at the end of the rail's own scroll rather than centred under the panes.
   */
  railFooter?: ReactNode;
  /** Session to land on — the `?openGroup=` back trip from a run page. */
  initialGroupId?: string | null;
  initialRunId?: string | null;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection>(EMPTY);
  /*
   * The run under the pointer on the trend chart — NOT a selection.
   *
   * The chart already knows which run you are reading; it prints it in the strip
   * above the plot. This carries the same id out to the two lists this screen
   * owns, so the rail row and the phone row light with it. It clears itself: the
   * chart null-fires on mouse-leave and on unmount, and the pane remounts on
   * every selection change.
   */
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);

  // Read the URL after mount so the server and first client render agree.
  useEffect(() => {
    const fromUrl = readSelection();
    setSelection(
      fromUrl.groupId || fromUrl.runId
        ? fromUrl
        : initialGroupId
          ? { groupId: initialGroupId, driverId: null, runId: initialRunId ?? null }
          : EMPTY
    );
  }, [initialGroupId, initialRunId]);

  // Back/forward should walk selections, not leave the page.
  useEffect(() => {
    const onPop = () => setSelection(readSelection());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = useCallback((next: Selection) => {
    setSelection(next);
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of [
      [GROUP_PARAM, next.groupId],
      [DRIVER_PARAM, next.driverId],
      [RUN_PARAM, next.runId],
    ] as const) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    // pushState, not router.push — selection is client state, and a server round
    // trip per click would make every level feel like a page load. The entry is
    // real history, so the phone's back gesture walks back up the stack.
    window.history.pushState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
  }, []);

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);

  /**
   * The session the pane opens on before you've picked one: the newest that has
   * a lap time in it.
   *
   * Not simply the newest. A single run logged this morning with the laps not yet
   * imported is a perfectly normal thing to have at the top of the archive, and
   * landing on it means the first thing a 1512px screen shows you is "No lap times
   * in this session yet" — the app looking broken on the strength of one unfinished
   * row. The rail still lists that session first and the highlight still names
   * whichever one the pane is showing, so nothing is hidden.
   */
  const defaultGroup = useMemo(
    () =>
      groups.find((g) => (g.teamDay?.dayBest ?? null) != null || g.trend != null) ??
      groups[0] ??
      null,
    [groups]
  );

  /**
   * What the pane shows. A group id from the URL that no longer exists (filtered
   * away, or an older page of the archive) must not blank the pane, so the pane
   * falls back to the default — but only the pane. The *phone* keeps showing its
   * list, because on a phone "fell back to something else" would read as the back
   * button having failed.
   */
  const paneGroup = selection.groupId
    ? groupsById.get(selection.groupId) ?? defaultGroup
    : defaultGroup;
  const activeDriver: WorkbenchDriver | null =
    (teamMode && selection.driverId
      ? paneGroup?.drivers?.find((d) => d.userId === selection.driverId)
      : null) ?? null;
  const activeRun = selection.runId ? runsById.get(selection.runId) ?? null : null;

  /** Depth on the phone. 0 → the list has the screen; anything else → the pane does. */
  const depth = selection.runId && activeRun ? 3 : selection.driverId ? 2 : selection.groupId ? 1 : 0;

  /*
   * A pushed screen on a phone should be the whole screen. The page header
   * ("Sessions") and the filter ribbon belong to the *list*, and leaving them
   * above a day cost 340 of 844 pixels before the first number — so the depth is
   * published on <body> and `globals.css` folds that chrome away below lg. A data
   * attribute rather than lifting the chrome into this component, because the
   * header is server-rendered and shared with the flat list.
   */
  useEffect(() => {
    document.body.dataset.sessionsDepth = depth > 0 ? "deep" : "top";
    return () => {
      delete document.body.dataset.sessionsDepth;
    };
  }, [depth]);

  const backHref = useCallback(() => {
    if (typeof window === "undefined") return "/runs/history";
    return `${window.location.pathname}${window.location.search}`;
  }, []);

  const openRun = useCallback(
    (runId: string) => {
      if (isSplitLayout() && runsById.has(runId)) {
        select({ ...selection, runId });
        return;
      }
      const back = encodeURIComponent(backHref());
      router.push(`/runs/${encodeURIComponent(runId)}?${BACK_PARAM}=${back}`);
    },
    [backHref, router, runsById, select, selection]
  );

  const goUp = useCallback(() => {
    if (selection.runId) select({ ...selection, runId: null });
    else if (selection.driverId) select({ ...selection, driverId: null, runId: null });
    else select(EMPTY);
  }, [select, selection]);

  /**
   * Hand the phone's fixed corner control our "up one level".
   *
   * That pill is the app's one back button on a phone — it already replaces the
   * page header's arrow rather than sitting on top of it — so a second chevron of
   * our own would land in the same 34px of screen. `useRegisterMobileBack` is how
   * a page takes it over; we register at every depth (at the top of the stack we
   * register exactly what `PageBackLink` would, `/analysis`, so it keeps behaving
   * as it always has and that link hides itself rather than duplicating).
   *
   * The href is the real destination for the case where nothing has hydrated yet;
   * the action only changes *how* we get there, keeping the rail's scroll and the
   * pane's state instead of reloading the page.
   */
  const upHref = useMemo(() => {
    const params = new URLSearchParams();
    if (teamMode && teamId) params.set("teamId", teamId);
    if (depth >= 2 && selection.groupId) params.set(GROUP_PARAM, selection.groupId);
    if (depth >= 3 && selection.driverId) params.set(DRIVER_PARAM, selection.driverId);
    if (depth === 0) return "/analysis";
    const query = params.toString();
    return query ? `/runs/history?${query}` : "/runs/history";
    // `depth` is derived from `selection`, which is what the linter can't see.
  }, [depth, selection.groupId, selection.driverId, teamId, teamMode]);
  const mobileBackAdopted = useRegisterMobileBack(upHref, depth > 0 ? goUp : null);

  if (groups.length === 0) return null;

  const ribbon =
    filtersActive && paneGroup ? <FilterRibbon group={paneGroup} labels={filterLabels} /> : null;

  const paneTitle = activeRun
    ? "Run"
    : activeDriver
      ? activeDriver.name
      : paneGroup?.title ?? "Session";
  const paneSub = activeRun
    ? paneGroup?.title ?? ""
    : activeDriver
      ? `${paneGroup?.dateLabel ?? ""}${paneGroup?.trackName ? ` · ${paneGroup.trackName}` : ""}`
      : `${paneGroup?.dateLabel ?? ""}${paneGroup?.trackName ? ` · ${paneGroup.trackName}` : ""}`;

  return (
    <div
      className={cn(
        "lg:grid lg:items-start lg:gap-4",
        // Two tracks up to 2xl, three from 1536 — the third only appears when the
        // middle can still afford 520px for the run record.
        "lg:grid-cols-[17rem_minmax(0,1fr)]",
        "2xl:grid-cols-[17rem_minmax(0,1fr)_19.5rem]",
        ribbon && "lg:grid-rows-[auto_minmax(0,1fr)]"
      )}
    >
      {/* `sr-only` is absolutely positioned, so it never claims a grid track. */}
      <p aria-live="polite" className="sr-only">
        {activeRun
          ? `Showing run detail in ${paneGroup?.title ?? "this session"}.`
          : activeDriver
            ? `Showing ${activeDriver.name}'s session.`
            : paneGroup
              ? `Showing ${paneGroup.title}.`
              : ""}
      </p>

      <SessionRail
        groups={groups}
        selection={selection}
        focusedRunId={focusedRunId}
        paneGroupId={paneGroup?.id ?? null}
        teamMode={teamMode}
        teamTitle={teamTitle}
        viewerUserId={viewerUserId}
        onSelect={select}
        onOpenRun={openRun}
        footer={railFooter}
        rowSpanClassName={ribbon ? "lg:row-span-2" : undefined}
        className={cn(depth > 0 && "max-lg:hidden")}
      />

      {ribbon}

      <div
        className={cn(
          depth === 0 && "max-lg:hidden",
          activeRun ? cn(PANE.stack, "2xl:contents") : "min-w-0 2xl:col-span-2"
        )}
        // Remounts the whole pane when the selection changes, which resets its
        // scroll for free — no ref, no imperative scrollTo.
        key={`${paneGroup?.id ?? ""}|${selection.driverId ?? ""}|${activeRun?.id ?? ""}`}
      >
        {/* The phone's back control. Desktop has the rail two inches to the left
            and doesn't need to be told where it is. */}
        {depth > 0 ? (
          /* Not sticky. `.app-shell` is `overflow-x: hidden`, which makes it a
             scroll port that never actually scrolls — the window scrolls it
             instead — so a `position: sticky` child pins to a box that is itself
             moving and simply leaves with the page. Every other header in this app
             scrolls away too, and the fixed band keeps the back control on screen. */
          <div
            className={cn(
              "mb-3 flex items-center lg:hidden",
              // The bar shares its row with the fixed corner pills — back on the
              // left, account on the right — so once the chrome has adopted the
              // back control this row stops being a row with a title in it and
              // becomes THE PILLS' BAND: it starts where they start, is at least
              // as tall as they are, and centres its title between them.
              //
              // Every number here is derived, not matched by eye (2026-08-16).
              // `--top-chrome-inset` is where the pill starts measured from the
              // top of the content; `.page-body`'s `pt-2` has already spent
              // 0.5rem of that, so the padding is the remainder. `min-height` is
              // that padding plus the pill's own 34px, which is what stops the
              // pill hanging past the row: before this the text stack ran out
              // 7px early and `mb-2` was spent entirely on the overhang, leaving
              // 0.6px between the pill and the card under it.
              //
              // 44px each side, not `pl` alone: `.page-body` already inset us
              // 20px, so this lands the title in the same 64px-inset slot the
              // condensed title uses (`.title-condenser`) — the handover on
              // scroll happens in place instead of jumping left to centre. The
              // old one-sided padding cleared the back pill and ignored the
              // account avatar, so a longer session name slid under it.
              //
              // `pointer-events-none` stops the row's own empty gutters from
              // swallowing taps aimed at the pills underneath — the title is not
              // interactive, so it costs nothing.
              mobileBackAdopted ? "pointer-events-none px-11 text-center" : "gap-2 pt-1"
            )}
            style={
              mobileBackAdopted
                ? {
                    paddingTop: "calc(var(--top-chrome-inset) - 0.5rem)",
                    minHeight: "calc(var(--top-chrome-inset) + 34px - 0.5rem)",
                  }
                : undefined
            }
          >
            {mobileBackAdopted ? null : (
              <button
                type="button"
                onClick={goUp}
                aria-label="Back"
                className="tap-active -ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-bold leading-tight text-foreground">
                {paneTitle}
              </span>
              {paneSub ? (
                <span className="mt-0.5 block truncate text-[11px] leading-none text-muted-foreground">
                  {paneSub}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}

        {activeRun && paneGroup ? (
          <RunPageClient
            run={activeRun}
            pickerRuns={pickerRuns}
            runListSource={runListSource}
            displayTimeZone={displayTimeZone}
            allowRunMutations={activeRun.userId === viewerUserId}
            runOwnerDisplayName={
              activeRun.userId === viewerUserId
                ? userDisplayName
                : memberDisplayByUserId[activeRun.userId ?? ""] ?? null
            }
            runOwnedByViewer={activeRun.userId === viewerUserId}
            placement="header"
            layout="split"
            columnClassName={PANE.card}
            onBack={() => select({ ...selection, runId: null })}
          />
        ) : activeDriver ? (
          <OneSession
            driverLabel={
              activeDriver.userId === viewerUserId ? "Your session" : activeDriver.name
            }
            summary={`${activeDriver.carName} · ${activeDriver.runs.length} run${
              activeDriver.runs.length === 1 ? "" : "s"
            } · ${
              activeDriver.delta == null
                ? "no timed lap"
                : activeDriver.delta === 0
                  ? "fastest of the day"
                  : `P${activeDriver.pos}, +${activeDriver.delta.toFixed(2)}`
            }`}
            trend={activeDriver.trend}
            rows={activeDriver.runs}
            focusedRunId={focusedRunId}
            onFocusRun={setFocusedRunId}
            onOpenRun={openRun}
          />
        ) : teamMode && paneGroup?.teamDay ? (
          <TeamDayCard
            day={paneGroup.teamDay}
            title={`${paneGroup.dateLabel}${paneGroup.trackName ? ` · ${paneGroup.trackName}` : ""}`}
            viewerUserId={viewerUserId}
            onSelectDriver={(driverId) =>
              select({ groupId: paneGroup.id, driverId, runId: null })
            }
            onSelectRun={openRun}
          />
        ) : paneGroup ? (
          <OneSession
            driverLabel={teamMode ? paneGroup.title : "The day"}
            summary={null}
            headline={paneGroup.headline}
            trend={paneGroup.trend}
            rows={paneGroup.runs}
            focusedRunId={focusedRunId}
            onFocusRun={setFocusedRunId}
            onOpenRun={openRun}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The pane's two shapes.
 *
 * `stack` is the run wrapper below 2xl — one scrolling column capped to the rail's
 * height. At 2xl the wrapper goes to `display: contents` and its two cards become
 * grid items in tracks 2 and 3, each scrolling on its own; the cap moves with them,
 * so there is only ever one scroller in play.
 */
const PANE = {
  stack: cn(
    "flex min-w-0 flex-col gap-4 lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-gutter:stable]",
    "lg:max-h-[calc(100vh-11.5rem)] 2xl:max-h-none 2xl:overflow-visible",
    "motion-safe:animate-[rc-pane-in_180ms_ease-out]"
  ),
  card: cn(
    "min-w-0 2xl:max-h-[calc(100vh-11.5rem)]",
    "2xl:overflow-y-auto 2xl:overscroll-contain 2xl:[scrollbar-gutter:stable]"
  ),
};

/**
 * One person's session — the leaf that solo calls its DAY and team calls a DRIVER.
 *
 * Identical component, identical props, whoever's runs these are. Solo passes the
 * group; team passes one driver's slice of it. Everything below this line is the
 * argument for giving solo the same form as team: there was never a second screen
 * to build.
 *
 * The chart is the shipped `SessionTrendCard`, dropped in unchanged — pace, the
 * Line/Spread toggle in its header, the same wrench-and-tyre gutter. The run list
 * under it is `lg:hidden`, because on the split layout those rows are already in
 * the rail.
 */
function OneSession({
  driverLabel,
  summary,
  headline,
  trend,
  rows,
  focusedRunId,
  onFocusRun,
  onOpenRun,
}: {
  driverLabel: string;
  summary: string | null;
  headline?: WorkbenchGroupHeadline | null;
  trend: AnalysisTrendModel | null;
  rows: WorkbenchRunRow[];
  /** Run under the pointer on the chart — tints its row, selects nothing. */
  focusedRunId: string | null;
  onFocusRun: (runId: string | null) => void;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 motion-safe:animate-[rc-pane-in_180ms_ease-out] lg:gap-4">
      {headline ? <DayHeadline headline={headline} /> : null}
      {summary ? (
        <div className="min-w-0 px-0.5">
          <Eyebrow className="mb-0">{driverLabel}</Eyebrow>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{summary}</p>
        </div>
      ) : null}
      {trend ? (
        <SessionTrendCard trend={trend} onSelectRun={onOpenRun} onFocusRun={onFocusRun} />
      ) : (
        <SurfaceCard variant="panel" contentClassName="p-6 text-[13px] text-muted-foreground">
          No lap times in this session yet. Open a run to see its details, or import laps to chart
          the day.
        </SurfaceCard>
      )}
      {/* Phone only — on the split layout these rows are the rail. */}
      <div className="lg:hidden">
        <div className="flex items-baseline gap-2 px-0.5 pb-1.5">
          <Eyebrow className="mb-0">Runs</Eyebrow>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {rows.length} · newest first
          </span>
        </div>
        {/*
          A door, not a table row.

          This was one 38px line — a 44px-wide label box, everything else at
          10.5px in one weight of grey, and a 3.5px chevron doing all the work of
          saying it opened. Two problems at 390px: the target was under the 44px
          a thumb wants with five of them stacked, and the box the name sat in
          could not hold a session's actual name, which is why the label was a
          code (see `runSessionName`).

          So: two lines and `min-h-14`, the name at 14px in full ink, the car and
          lap count demoted beneath it, and the chevron taking ink and sliding on
          press — the same treatment `AssetListRow` gives every openable row in
          the app. `group` is on the button so the chevron can answer a press
          anywhere on the row rather than only under the finger.

          It carried ONE figure until 2026-08-17, and one figure is a single hot
          lap. A run can hold the day's second-fastest lap and the day's third
          top-5 at the same time, and the old row could not say so — you had to
          open each run in turn to find out how the car actually ran. Best, top 5
          and top 10 now sit side by side.

          Fixed column widths (52/50/50) are the whole point, not tidiness: the
          digits have to land on the same x down the whole list or you are
          reading five rows instead of scanning one column, which is the only
          reason to put them here rather than inside the run. `tabular-nums`
          finishes the job — Sora's proportional digits would still wobble.

          The labels are stated ONCE in a header strip rather than beside every
          number; per-row labels would cost ~90px of a 342px row and repeat four
          times to say the same three words.
        */}
        <SurfaceCard variant="panel" contentClassName="p-0">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
            <span className="min-w-0 flex-1 text-[9.5px] font-semibold uppercase tracking-wider text-faint">
              Run
            </span>
            <span className="w-[52px] shrink-0 text-right text-[9.5px] font-semibold uppercase tracking-wider text-faint">
              Best
            </span>
            <span className="w-[50px] shrink-0 text-right text-[9.5px] font-semibold uppercase tracking-wider text-faint">
              Top 5
            </span>
            <span className="w-[50px] shrink-0 text-right text-[9.5px] font-semibold uppercase tracking-wider text-faint">
              Top 10
            </span>
            {/* Holds the chevron's column open so the headings sit over their
                own figures rather than one slot to the right. */}
            <span className="h-4 w-4 shrink-0" aria-hidden />
          </div>
          {rows.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onOpenRun(run.id)}
              className={cn(
                "group tap-active flex min-h-14 w-full items-center gap-2 border-b border-l-2 border-border px-3 py-2.5 text-left transition-colors last:border-b-0",
                "active:bg-muted/60 hover:bg-muted/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                // Tapping a point on the chart above lights its row here — the
                // same fill a pointer on the row would give it, so the gesture
                // reads as pointing, not as selecting. Tapping the row is what
                // opens the run.
                run.id === focusedRunId
                  ? "border-l-primary-ink/40 bg-muted/40"
                  : "border-l-transparent"
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] font-semibold leading-tight tracking-tight text-foreground">
                  {run.label}
                </span>
                <span className="truncate text-[11px] leading-none text-faint">
                  {run.carName} · {run.lapCount} laps
                </span>
              </span>
              {run.needsLapImport ? (
                <TriangleAlert
                  className="h-4 w-4 shrink-0 text-warning"
                  aria-label="No lap times on this run"
                />
              ) : null}
              {/* Green stays on BEST alone. It means "fastest lap of this
                  session" and it can only go on the figure that claim is about;
                  tinting all three would turn every row into three verdicts and
                  the mark would stop meaning anything. */}
              <span
                className={cn(
                  "w-[52px] shrink-0 text-right text-[15px] font-semibold tabular-nums leading-tight",
                  run.isGroupBest ? "text-gain" : "text-foreground"
                )}
              >
                {run.best != null ? formatLap(run.best) : "—"}
              </span>
              <span className="w-[50px] shrink-0 text-right text-[12.5px] tabular-nums leading-tight text-muted-foreground">
                {run.avgTop5 != null ? formatLap(run.avgTop5) : "—"}
              </span>
              <span className="w-[50px] shrink-0 text-right text-[12.5px] tabular-nums leading-tight text-muted-foreground">
                {run.avgTop10 != null ? formatLap(run.avgTop10) : "—"}
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-faint transition-all group-hover:translate-x-0.5 group-hover:text-foreground group-active:translate-x-0.5 group-active:text-foreground"
                aria-hidden
              />
            </button>
          ))}
        </SurfaceCard>
      </div>
    </div>
  );
}

/**
 * The two numbers above a solo day.
 *
 * It carried a third — **vs your last day at this track**, signed lap-delta —
 * plus a line under the tiles explaining that negative is faster. Both are gone
 * (2026-08-16): a strip that stood 93px tall pushed the chart, which is what the
 * screen is actually for, most of the way off a phone. The comparison is not
 * lost work if it comes back somewhere cheaper — `headline.priorDelta` is still
 * computed in `sessionWorkbenchModel`.
 */
function DayHeadline({ headline }: { headline: WorkbenchGroupHeadline }) {
  return (
    <SurfaceCard variant="panel" contentClassName="p-0">
      <div className="grid grid-cols-2 divide-x divide-border">
        <Figure label="Best lap" value={headline.best != null ? formatLap(headline.best) : "—"} />
        <Figure label="Runs" value={String(headline.runCount)} />
      </div>
    </SurfaceCard>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="truncate text-[9.5px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold tabular-nums leading-tight text-foreground">
        {value}
      </div>
    </div>
  );
}

/** How many filter labels the ribbon spells out before it starts counting them. */
const RIBBON_LABEL_LIMIT = 2;

/**
 * One line above the pane naming the filter that produced what you're reading.
 *
 * Without it a session holding 2 of its 8 runs reads as the whole day. The pills
 * at the top of the page say which filters are on; this says what they did to
 * *this* session, which is the part you can't see. Muted, hairline, no colour:
 * orientation, not a warning.
 */
function FilterRibbon({ group, labels }: { group: WorkbenchGroup; labels: string[] }) {
  const shown = labels.slice(0, RIBBON_LABEL_LIMIT);
  const rest = labels.length - shown.length;
  const parts = [
    group.totalRuns != null && group.totalRuns > group.runs.length
      ? `${group.runs.length} of ${group.totalRuns} runs`
      : `${group.runs.length} run${group.runs.length !== 1 ? "s" : ""} match`,
    ...shown,
    ...(rest > 0 ? [`+${rest} more`] : []),
  ];
  return (
    <p className="mb-2 min-w-0 truncate border-b border-border pb-2 text-[11px] leading-none text-muted-foreground max-lg:hidden lg:col-start-2 lg:mb-0 2xl:col-span-2">
      {parts.join(" · ")}
    </p>
  );
}

/**
 * The archive rail: sessions, each opening to its drivers (team) or its runs
 * (solo), with a selection spine down the left edge.
 *
 * The spine is one accent rail that runs through the open session and brightens
 * at the open run, so "which day, which run" reads as one unbroken line rather
 * than two highlights competing for the same meaning.
 *
 * On a phone this is the whole Sessions screen, so its rows are sized for a thumb
 * (44px+) and drop back to the desktop's compact rhythm at lg.
 */
function SessionRail({
  groups,
  selection,
  focusedRunId,
  paneGroupId,
  teamMode,
  teamTitle,
  viewerUserId,
  onSelect,
  onOpenRun,
  footer,
  rowSpanClassName,
  className,
}: {
  groups: WorkbenchGroup[];
  selection: Selection;
  /** Run under the pointer on the pane's chart; tints its row, selects nothing. */
  focusedRunId: string | null;
  paneGroupId: string | null;
  teamMode: boolean;
  teamTitle: string | null;
  viewerUserId: string;
  onSelect: (next: Selection) => void;
  onOpenRun: (runId: string) => void;
  footer?: ReactNode;
  rowSpanClassName?: string;
  className?: string;
}) {
  return (
    <div
      role="listbox"
      aria-label={teamMode ? `Sessions shared with ${teamTitle ?? "your team"}` : "Sessions"}
      // Demo walkthrough stop 3. One rail now serves both layouts, so unlike the
      // old split (accordion card + workbench rail, both carrying this id) there
      // is exactly one node to resolve.
      data-tour="sessions"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        "lg:max-h-[calc(100vh-11.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-gutter:stable]",
        rowSpanClassName,
        className
      )}
    >
      {groups.map((group, index) => {
        // Marked open whenever the pane is showing it, including the landing
        // session nobody has clicked yet — otherwise a fresh desktop load reads
        // as a pane with no row to attribute it to, which is just two lists.
        const open = group.id === paneGroupId;
        // But only an EXPLICIT pick can be un-picked. Collapsing on `open` alone
        // made the landing row a no-op on a phone: it looked closed, it was
        // marked open, and tapping it "closed" a screen you were never on.
        const chosen = selection.groupId === group.id;
        /*
         * Where the row is allowed to LOOK open — spine, tint, ring, green lap.
         *
         * `open` includes the landing session the pane falls back to before
         * anyone has clicked (see `defaultGroup`). At lg+ that is honest: the
         * pane really is showing that day, and the mark is what attributes it to
         * a row. On a phone there is no pane at this depth, so the same mark lit
         * the newest session for a screen you were never on — an up-caret, a
         * yellow spine and a green best lap on a list you had only just opened.
         *
         * So: an explicit pick marks at every width; the desktop's fallback
         * marks only where a pane exists to justify it. Folded in CSS rather
         * than read off the viewport, like everything else in this file.
         */
        const markAlways = chosen;
        const markAtLg = open && !chosen;
        const isRaceMeeting = group.type === "Event";
        const lead = group.teamDay?.drivers[0] ?? null;
        const groupBest =
          group.headline?.best ??
          lead?.best ??
          (() => {
            const bests = group.runs.map((r) => r.best).filter((b): b is number => b != null);
            return bests.length ? Math.min(...bests) : null;
          })();
        /*
         * Track first, title second.
         *
         * "Test day" is the title on nine rows out of twelve, so as the loud line
         * it told you almost nothing while the track — the thing you actually scan
         * an archive for — sat at 10px in `text-faint` behind the date. Line 1 is
         * now WHERE, line 2 is WHEN and WHAT. A session with no track recorded
         * falls back to the title on line 1 and a bare date on line 2, so the
         * three-line shape holds either way.
         */
        const where = group.trackName ?? group.title;
        const whenWhat = group.trackName ? `${group.dateLabel} · ${group.title}` : group.dateLabel;
        /*
         * Line 3 is one expression for both scopes, not a `teamMode` branch: each
         * segment appears when its data says something and is skipped when it
         * doesn't. A team day with a single driver therefore renders identically
         * to a solo day — which is the whole reason team and solo are one screen.
         */
        const driverCount =
          teamMode && group.drivers && group.drivers.length > 1 ? group.drivers.length : null;
        return (
          <div
            key={group.id}
            className={cn(
              "border-l-2 border-transparent transition-colors",
              markAlways && "border-primary-ink/30 bg-muted/25",
              markAtLg && "lg:border-primary-ink/30 lg:bg-muted/25",
              index > 0 && "border-t border-t-border"
            )}
          >
            <button
              type="button"
              role="option"
              // `chosen`, not `open`: a row nobody has picked must not announce
              // itself as selected, and on a phone the fallback picks one.
              aria-selected={chosen && !selection.driverId && !selection.runId}
              onClick={() =>
                onSelect(
                  chosen && !selection.driverId && !selection.runId
                    ? EMPTY
                    : { groupId: group.id, driverId: null, runId: null }
                )
              }
              className="tap-active flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 lg:py-2.5"
            >
              <span
                className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors lg:h-8 lg:w-8 lg:rounded-lg",
                  "border-border bg-secondary text-muted-foreground",
                  markAlways && "border-ring/40 bg-muted text-foreground",
                  markAtLg && "lg:border-ring/40 lg:bg-muted lg:text-foreground"
                )}
                aria-hidden
              >
                {isRaceMeeting ? (
                  <Flag className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
                ) : (
                  <Wrench className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
                )}
              </span>
              {/* Three lines: where, when-and-what, how-much. Never dimmed on the
                  closed rows — the spine and the tint already say which session is
                  open, and dimming eleven rows to mark one made the whole column
                  read as murk. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold leading-tight text-foreground lg:text-[13px]">
                  {where}
                </span>
                <span className="mt-[3px] block truncate tabular-nums text-[12px] leading-tight text-muted-foreground lg:text-[11px]">
                  {whenWhat}
                </span>
                {/* The fastest LAP, not the fastest driver's name: a name pushes
                    this line past 264px and it clipped to "fastest Glen…", which
                    tells you neither who nor how quick. The name is the first
                    thing the day itself shows. */}
                <span className="mt-[3px] block truncate tabular-nums text-[11px] leading-none text-faint lg:text-[10px]">
                  {driverCount ? `${driverCount} drivers · ` : ""}
                  {railRunCount(group)}
                  {groupBest != null ? (
                    <>
                      {" · best "}
                      {/* Gain green on the open session only — the rail's number and
                          the chart's fastest point are then the same colour for the
                          same lap, and a closed row stays a quiet three lines. On a
                          phone the chart is a screen away, so the green goes with it. */}
                      <span
                        className={cn(markAlways && "text-gain", markAtLg && "lg:text-gain")}
                      >
                        {formatLap(groupBest)}
                      </span>
                    </>
                  ) : null}
                </span>
              </span>
              {/*
                * Two carets, one per folding — because the gesture is not the same
                * one at both widths.
                *
                * At lg+ the row expands in place (the tree below is `hidden lg:block`),
                * so the caret points down at where the content will appear and flips
                * to point back at the row that opened it. Below lg nothing expands:
                * picking a session takes `depth` above 0, the rail goes `max-lg:hidden`
                * and the day takes the screen. That is a push, and a push points right —
                * the same arrow the run rows inside a day already use.
                *
                * Two nodes rather than rotating one: a `-rotate-90` on something named
                * ChevronDown is invisible to anyone reading this later.
                */}
              <ChevronRight className="h-4 w-4 shrink-0 text-faint lg:hidden" aria-hidden />
              <ChevronDown
                className={cn(
                  "hidden h-4 w-4 shrink-0 text-faint transition-transform lg:block lg:h-3.5 lg:w-3.5",
                  open && "lg:rotate-180"
                )}
                aria-hidden
              />
            </button>

            {/* Nested levels are the split layout's job. On a phone the rail IS the
                sessions screen and picking a day pushes to it, so a tree here would
                be a second way to do the same thing. */}
            {open ? (
              <div className="hidden lg:block">
                {teamMode && group.drivers ? (
                  <DriverRail
                    drivers={group.drivers}
                    selection={selection}
                    focusedRunId={focusedRunId}
                    groupId={group.id}
                    viewerUserId={viewerUserId}
                    onSelect={onSelect}
                    onOpenRun={onOpenRun}
                  />
                ) : (
                  <RunRail
                    runs={group.runs}
                    selectedRunId={selection.runId}
                    focusedRunId={focusedRunId}
                    onOpenRun={onOpenRun}
                  />
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {footer ? <div className="border-t border-border px-3 py-2.5">{footer}</div> : null}
    </div>
  );
}

/**
 * "2/8 runs", not "2 of 8": the whole line truncates at 264px and the spelled-out
 * form clipped the count off the row. The ribbon above the pane spells it out for
 * the open session, so the rail only has to carry the ratio.
 */
function railRunCount(group: WorkbenchGroup): string {
  const shown = group.runs.length;
  if (group.totalRuns != null && group.totalRuns > shown) return `${shown}/${group.totalRuns} runs`;
  return `${shown} run${shown !== 1 ? "s" : ""}`;
}

/** Team scope only: the session's roster, fastest first, each opening to their runs. */
function DriverRail({
  drivers,
  selection,
  focusedRunId,
  groupId,
  viewerUserId,
  onSelect,
  onOpenRun,
}: {
  drivers: WorkbenchDriver[];
  selection: Selection;
  focusedRunId: string | null;
  groupId: string;
  viewerUserId: string;
  onSelect: (next: Selection) => void;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <div className="pb-1">
      {drivers.map((driver) => {
        const open = driver.userId === selection.driverId;
        return (
          <div
            key={driver.userId}
            className={cn(
              "-ml-[2px] border-l-2 transition-colors",
              open ? "border-primary-ink/40" : "border-transparent"
            )}
          >
            <button
              type="button"
              role="option"
              aria-selected={open && !selection.runId}
              onClick={() =>
                onSelect(
                  open && !selection.runId
                    ? { groupId, driverId: null, runId: null }
                    : { groupId, driverId: driver.userId, runId: null }
                )
              }
              className="flex w-full min-w-0 items-center gap-2 py-1.5 pl-[1.9rem] pr-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
            >
              <span className="w-3 shrink-0 text-right text-[10px] tabular-nums text-faint">
                {driver.pos}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px] font-semibold",
                  open ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {driver.name}
                {driver.userId === viewerUserId ? (
                  <span className="ml-1 text-[9px] font-bold uppercase tracking-wider text-faint">
                    you
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {driver.best != null ? formatLap(driver.best) : "—"}
              </span>
              {/* Same disclosure, one level in — same caret, or the rail would
                  carry two different arrows for one gesture. */}
              <ChevronDown
                className={cn(
                  "h-3 w-3 shrink-0 text-faint transition-transform",
                  open && "rotate-180"
                )}
                aria-hidden
              />
            </button>
            {open ? (
              <RunRail
                runs={driver.runs}
                selectedRunId={selection.runId}
                focusedRunId={focusedRunId}
                onOpenRun={onOpenRun}
                indentClassName="pl-[3.1rem]"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RunRail({
  runs,
  selectedRunId,
  focusedRunId,
  onOpenRun,
  indentClassName = "pl-[2.375rem]",
}: {
  runs: WorkbenchRunRow[];
  selectedRunId: string | null;
  /** Run under the pointer on the chart; tints its row, selects nothing. */
  focusedRunId: string | null;
  onOpenRun: (runId: string) => void;
  indentClassName?: string;
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
    onOpenRun(target.id);
    const el = event.currentTarget.parentElement?.children[next] as HTMLElement | undefined;
    el?.focus();
  };

  return (
    <div className="pb-1.5">
      {runs.map((run, index) => {
        const active = run.id === selectedRunId;
        // Pointed at on the chart, not open. Deliberately a weaker mark than
        // `active` — a dim spine over a half-strength fill — so the row you are
        // sweeping past can never be mistaken for the run in the pane.
        const focused = !active && run.id === focusedRunId;
        return (
          <div
            key={run.id}
            ref={active ? activeRef : undefined}
            role="option"
            tabIndex={0}
            aria-selected={active}
            // Neither this row nor the phone's list row is an <a>, so the demo
            // walkthrough has no href to read when it needs to open a run. Inert markup.
            data-run-id={run.id}
            onClick={() => onOpenRun(run.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenRun(run.id);
                return;
              }
              onKeyDown(event, index);
            }}
            className={cn(
              // -ml-[2px] + its own left border continues the spine rather than
              // sitting inside it, so the rail reads as one line.
              "group/run relative -ml-[2px] flex cursor-pointer items-baseline gap-2.5 border-l-2 py-1 pr-3 transition-colors",
              indentClassName,
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
              active
                ? "border-primary-ink bg-muted text-foreground"
                : focused
                  ? "border-primary-ink/40 bg-muted/40"
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
              // At lg+ this rail IS Sessions, so the mark has to be actionable here
              // or the desktop has no way in. `?step=laps` because
              // firstUnfinishedStep would otherwise stop at the first empty step.
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(lapImportHref(run.id));
                }}
                onKeyDown={(event) => event.stopPropagation()}
                aria-label={`Lap times missing on ${run.label} — import them`}
                title="No lap times on this run — tap to import"
                className="inline-flex shrink-0 items-center justify-center rounded border border-amber-500/40 bg-amber-500/10 p-0.5 text-amber-900 transition hover:bg-amber-500/20 dark:text-amber-100"
              >
                <TriangleAlert className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
            <span className="shrink-0 tabular-nums text-[10px] text-faint">
              {run.lapCount} laps
            </span>
            <span
              className={cn(
                // Gain green, matching every other "this is the fast one" mark in
                // the app. A CSS var, not a Tailwind colour — hence the literal.
                "shrink-0 text-[11px] tabular-nums",
                run.isGroupBest ? "text-gain" : "text-foreground"
              )}
              title={run.isGroupBest ? "Fastest lap of this session" : undefined}
            >
              {run.best != null ? formatLap(run.best) : "—"}
            </span>
            {/* The same arrow the phone row carries, so a run row means the same
                thing at both widths. Held at low opacity until the row is under
                the pointer — a column of arrows down a dense rail would read as
                decoration, and the open row already has the spine. */}
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 transition-all",
                active
                  ? "text-foreground"
                  : "text-faint opacity-0 group-hover/run:translate-x-0.5 group-hover/run:opacity-100"
              )}
              aria-hidden
            />
          </div>
        );
      })}
    </div>
  );
}
