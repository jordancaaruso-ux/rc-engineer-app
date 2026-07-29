"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RunDetailPanel, type Run } from "@/components/runs/RunDetailPanel";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/runs/RunHistoryModalsLazy";
import { RunLapAnalysisModal } from "@/components/runs/RunHistoryModalsLazy";
import { ButtonLink } from "@/components/ui/ButtonLink";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";

/**
 * Client shell for `/runs/[id]` — the same `RunDetailPanel` Sessions renders, plus the
 * setup-sheet and lap-compare modals that lived on the Sessions *row* (not in the detail),
 * so the page keeps every affordance the expanded row had.
 */
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
      <div className="flex flex-wrap items-center gap-2">
        {allowRunMutations ? (
          <ButtonLink href={`/engineer?runId=${encodeURIComponent(run.id)}`}>
            Ask the Engineer
          </ButtonLink>
        ) : null}
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          className="ui-strong shrink-0 whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground hover:bg-muted/80 transition"
          title="View setup sheet for this run; compare to another run from the modal"
        >
          View setup
        </button>
        <button
          type="button"
          onClick={() => setLapsOpen(true)}
          className="ui-strong shrink-0 whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground hover:bg-muted/80 transition"
          title="Open lap column compare for this run"
        >
          Lap times
        </button>
      </div>

      <RunDetailPanel
        run={run}
        pickerRuns={pickerRuns}
        runListSource={runListSource}
        displayTimeZone={displayTimeZone}
        allowRunMutations={allowRunMutations}
        onDeleted={() => router.push("/runs/history")}
      />

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
