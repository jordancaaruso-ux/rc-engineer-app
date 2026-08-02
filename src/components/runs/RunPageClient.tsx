"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkle, SlidersHorizontal, Timer } from "lucide-react";
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
 * breaks out on the left, sized to its own words — it wears the full Add-run treatment (gradient
 * face, `logrun-glow` aura, `logrun-fx` hotspot, all shared with `LogRunFab`) and is the one live
 * control on the screen. Setup + Laptimes stay welded into one inert glass pair on the right, and
 * the detail card floats free below with all four corners. 12.5px type and a 46px height (above
 * the 44px touch floor) are what let both utility labels survive at 360px.
 */

const UTILITY_SEGMENT_CLASS =
  "tap-active flex min-h-[46px] min-w-0 items-center justify-center gap-1.5 px-[11px] " +
  "text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground";

export function RunPageClient({
  run,
  pickerRuns,
  runListSource,
  displayTimeZone,
  allowRunMutations,
  runOwnerDisplayName,
  runOwnedByViewer,
}: {
  run: Run;
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  displayTimeZone: string | null;
  allowRunMutations: boolean;
  /** Driver of this run. A teammate's name on a shared session — never the viewer's. */
  runOwnerDisplayName: string | null;
  runOwnedByViewer: boolean;
}) {
  const router = useRouter();
  const [setupOpen, setSetupOpen] = useState(false);
  const [lapsOpen, setLapsOpen] = useState(false);

  const sameCarPickerRuns = run.carId
    ? pickerRuns.filter((r) => r.car?.id === run.carId)
    : pickerRuns;

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
              <span className="logrun-fx" aria-hidden />
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
          pickerRunsSameCar={sameCarPickerRuns}
          runListSource={runListSource}
          userDisplayName={runOwnerDisplayName}
          runOwnedByViewer={runOwnedByViewer}
          viewerUserId={null}
        />
      ) : null}
    </div>
  );
}
