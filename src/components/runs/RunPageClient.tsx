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
 * action strip (founder picks 2026-07-29: instrument strip, fused to the first card, Engineer
 * segment wearing the full Add-run treatment — gradient face, `logrun-glow` aura, `logrun-fx`
 * hotspot, all shared with `LogRunFab`). The setup-sheet and lap-compare modals lived on the
 * Sessions *row*, not in the detail, so the strip is what keeps those affordances on the page.
 */

const UTILITY_SEGMENT_CLASS =
  "tap-active flex min-h-12 items-center justify-center gap-2 border-l border-border px-2 " +
  "text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground";

export function RunPageClient({
  run,
  pickerRuns,
  runListSource,
  displayTimeZone,
  allowRunMutations,
  userDisplayName,
}: {
  run: Run;
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  displayTimeZone: string | null;
  allowRunMutations: boolean;
  userDisplayName: string | null;
}) {
  const router = useRouter();
  const [setupOpen, setSetupOpen] = useState(false);
  const [lapsOpen, setLapsOpen] = useState(false);

  const sameCarPickerRuns = run.carId
    ? pickerRuns.filter((r) => r.car?.id === run.carId)
    : pickerRuns;

  return (
    <div className="space-y-3">
      <div>
        <div
          role="group"
          aria-label="Run actions"
          className={cn(
            "grid overflow-hidden rounded-t-xl border border-b-0 border-border bg-card",
            allowRunMutations ? "grid-cols-[1.4fr_1fr_1fr]" : "grid-cols-2"
          )}
        >
          {allowRunMutations ? (
            <button
              type="button"
              onClick={() => router.push(`/engineer?runId=${encodeURIComponent(run.id)}`)}
              className="tap-active logrun-glow relative isolate flex min-h-12 items-center justify-center gap-2 bg-[linear-gradient(180deg,#ffdf3d_0%,#FFD60A_38%)] px-2 text-[13px] font-bold tracking-[-0.01em] text-primary-foreground shadow-[inset_0_1.5px_0_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(0,0,0,0.18)]"
              title="Open the Engineer anchored to this run"
            >
              <span className="logrun-fx" aria-hidden />
              <Sparkle className="relative z-[2] h-4 w-4" fill="currentColor" aria-hidden />
              <span className="relative z-[2]">Ask the Engineer</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className={cn(UTILITY_SEGMENT_CLASS, !allowRunMutations && "border-l-0")}
            title="View setup sheet for this run; compare to another run from the modal"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Setup
          </button>
          <button
            type="button"
            onClick={() => setLapsOpen(true)}
            className={UTILITY_SEGMENT_CLASS}
            title="Open lap column compare for this run"
          >
            <Timer className="h-4 w-4" aria-hidden />
            Laps
          </button>
        </div>

        <RunDetailPanel
          run={run}
          pickerRuns={pickerRuns}
          runListSource={runListSource}
          displayTimeZone={displayTimeZone}
          allowRunMutations={allowRunMutations}
          onDeleted={() => router.push("/runs/history")}
          className="rounded-t-none"
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
          userDisplayName={userDisplayName}
          viewerUserId={null}
        />
      ) : null}
    </div>
  );
}
