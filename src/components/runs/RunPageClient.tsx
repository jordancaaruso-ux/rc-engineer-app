"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Sparkle, SlidersHorizontal, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { RunDetailPanel, type Run } from "@/components/runs/RunDetailPanel";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/runs/RunHistoryModalsLazy";
import { RunLapAnalysisModal } from "@/components/runs/RunHistoryModalsLazy";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";

/**
 * Client shell for `/runs/[id]` — the same `RunDetailPanel` Sessions rendered, topped by the
 * action strip. The setup-sheet and lap-compare modals lived on the Sessions *row*, not in the
 * detail, so the strip is what keeps those affordances on the page.
 *
 * Split row (founder pick 2026-07-29, replacing the fused 3-segment strip): "Ask the Engineer"
 * breaks out on the left, sized to its own words, and is the one live control on the screen. It
 * keeps its gradient face and its `logrun-glow` aura, but NOT the crossing sheen band it used to
 * share with `LogRunFab` — as of 2026-08-18 that band is reserved for the two surfaces that are
 * literally the start-a-run action (the dashboard bar and the dock circle), and this is the run
 * page's own hero rather than the app's. Setup + Laptimes stay welded into one inert glass pair on the right, and
 * the detail card floats free below with all four corners. 12.5px type and a 46px height (above
 * the 44px touch floor) are what let both utility labels survive at 360px.
 *
 * `placement="header"` folds that same trio onto the detail card's own "Session details" line
 * instead. It exists for the Sessions workbench, where the strip's 46px band sat between the
 * filter bar and the first content and knocked the pane out of alignment with the rail beside it.
 * Compact means 32px and no `logrun-glow` — a card header shouldn't emit light — but the gradient
 * face and hotspot stay, because it is still the one live control here. It is desktop-pane only:
 * three labelled controls plus a heading need ~590px, so the phone keeps the split row.
 */

const UTILITY_SEGMENT_CLASS =
  "tap-active flex min-h-[46px] min-w-0 items-center justify-center gap-1.5 px-[11px] " +
  "text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground";

const COMPACT_SEGMENT_CLASS =
  "tap-active flex h-8 min-w-0 items-center justify-center gap-1.5 px-2.5 " +
  "text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground";

export function RunPageClient({
  run,
  pickerRuns,
  runListSource,
  displayTimeZone,
  allowRunMutations,
  runOwnerDisplayName,
  runOwnedByViewer,
  placement = "strip",
  onBack,
  layout = "single",
  columnClassName,
}: {
  run: Run;
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  displayTimeZone: string | null;
  allowRunMutations: boolean;
  /** Driver of this run. A teammate's name on a shared session — never the viewer's. */
  runOwnerDisplayName: string | null;
  runOwnedByViewer: boolean;
  /** Where the run's controls live — a strip above the card, or on the card's header line. */
  placement?: "strip" | "header";
  /** Up one level. Renders a back control at the head of the card, `placement="header"` only. */
  onBack?: () => void;
  /**
   * `"split"` returns the record and the log as two sibling cards with no wrapper,
   * so the caller's grid places them in its own tracks. The caller must therefore
   * be a grid — anything else gets two stacked cards, which is not wrong, just not
   * what it's for.
   */
  layout?: "single" | "split";
  /** Passed to both column cards in split mode. */
  columnClassName?: string;
}) {
  const router = useRouter();
  const [setupOpen, setSetupOpen] = useState(false);
  const [lapsOpen, setLapsOpen] = useState(false);
  const inHeader = placement === "header";

  // Own runs arrive already filtered to this car by the server query, so this is belt-and-braces.
  // A teammate's arrive scoped to the run's *discipline* instead — re-cutting those to the exact
  // car would throw away everything the page just went and fetched.
  const lapComparePickerRuns =
    runOwnedByViewer && run.carId
      ? pickerRuns.filter((r) => r.car?.id === run.carId)
      : pickerRuns;

  const modals = (
    <>
      <SetupSheetModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        run={setupOpen ? (run as unknown as SetupSheetModalRun) : null}
        pickerRuns={pickerRuns as SetupSheetModalRun[]}
        runListSource={runListSource}
        viewerUserId={null}
      />
      {lapsOpen ? (
        <RunLapAnalysisModal
          open={lapsOpen}
          onClose={() => setLapsOpen(false)}
          run={run}
          pickerRunsSameCar={lapComparePickerRuns}
          runListSource={runListSource}
          userDisplayName={runOwnerDisplayName}
          runOwnedByViewer={runOwnedByViewer}
          viewerUserId={null}
        />
      ) : null}
    </>
  );

  const compactActions = (
    <div role="group" aria-label="Run actions" className="flex items-center gap-2">
      {allowRunMutations ? (
        <button
          type="button"
          onClick={() => router.push(`/engineer?pin=run:${encodeURIComponent(run.id)}`)}
          className="tap-active relative isolate flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[linear-gradient(180deg,#ffdf3d_0%,#FFD60A_38%)] px-2.5 text-[12px] font-bold tracking-[-0.01em] text-primary-foreground shadow-[inset_0_1.5px_0_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(0,0,0,0.18)]"
          title="Open the Engineer anchored to this run"
        >
          <Sparkle className="relative z-[2] h-3.5 w-3.5" fill="currentColor" aria-hidden />
          <span className="relative z-[2] whitespace-nowrap">Ask the Engineer</span>
        </button>
      ) : null}
      <div className="glass-card flex min-w-0 shrink overflow-hidden rounded-lg border">
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          className={COMPACT_SEGMENT_CLASS}
          title="View setup sheet for this run; compare to another run from the modal"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Setup
        </button>
        <button
          type="button"
          onClick={() => setLapsOpen(true)}
          className={cn(COMPACT_SEGMENT_CLASS, "border-l border-border")}
          title="Open lap column compare for this run"
        >
          <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Laptimes
        </button>
      </div>
    </div>
  );

  // Icon-only, and the same 32px square as the edit button on the far right — the
  // two bookend the header line, with the labelled controls between them.
  const backControl = onBack ? (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to the whole session"
      title="Back to the whole session"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
    </button>
  ) : null;

  if (inHeader) {
    const panel = (
      <RunDetailPanel
        run={run}
        pickerRuns={pickerRuns}
        runListSource={runListSource}
        displayTimeZone={displayTimeZone}
        allowRunMutations={allowRunMutations}
        onDeleted={() => router.push("/runs/history")}
        headerLead={backControl}
        headerActions={compactActions}
        layout={layout}
        columnClassName={columnClassName}
      />
    );
    // Split mode returns two cards that must be direct grid children, so there is
    // no wrapper to hang the modals off. They mount as fixed-position overlays and
    // are out of flow either way — a fragment keeps the grid seeing exactly two.
    return layout === "split" ? (
      <>
        {panel}
        {modals}
      </>
    ) : (
      <div className="space-y-3">
        {panel}
        {modals}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div role="group" aria-label="Run actions" className="flex items-stretch justify-between gap-2">
          {allowRunMutations ? (
            <button
              type="button"
              onClick={() => router.push(`/engineer?pin=run:${encodeURIComponent(run.id)}`)}
              className="tap-active logrun-glow relative isolate flex min-h-[46px] shrink-0 items-center justify-center gap-[7px] rounded-xl bg-[linear-gradient(180deg,#ffdf3d_0%,#FFD60A_38%)] px-[13px] text-[12.5px] font-bold tracking-[-0.01em] text-primary-foreground shadow-[inset_0_1.5px_0_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(0,0,0,0.18)]"
              title="Open the Engineer anchored to this run"
            >
              <Sparkle className="relative z-[2] h-4 w-4" fill="currentColor" aria-hidden />
              <span className="relative z-[2] whitespace-nowrap">Ask the Engineer</span>
            </button>
          ) : null}
          {/* Setup + Laptimes read as one object — same glass as the card, single hairline between. */}
          <div
            className={cn(
              "glass-card flex min-w-0 overflow-hidden rounded-xl border",
              allowRunMutations ? "shrink" : "flex-1"
            )}
          >
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className={cn(UTILITY_SEGMENT_CLASS, !allowRunMutations && "flex-1")}
              title="View setup sheet for this run; compare to another run from the modal"
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
              Setup
            </button>
            <button
              type="button"
              onClick={() => setLapsOpen(true)}
              className={cn(UTILITY_SEGMENT_CLASS, "border-l border-border", !allowRunMutations && "flex-1")}
              title="Open lap column compare for this run"
            >
              <Timer className="h-4 w-4 shrink-0" aria-hidden />
              Laptimes
            </button>
          </div>
        </div>

        <RunDetailPanel
          run={run}
          pickerRuns={pickerRuns}
          runListSource={runListSource}
          displayTimeZone={displayTimeZone}
          allowRunMutations={allowRunMutations}
          onDeleted={() => router.push("/runs/history")}
        />
      </div>

      {modals}
    </div>
  );
}
