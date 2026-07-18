"use client";

import { useMemo, useState } from "react";
import { NewRunForm } from "@/components/runs/NewRunFormDynamic";
import type { WizardDraftRow } from "@/components/runs/WizardStartControls";
import type { EntryCandidate } from "@/lib/runs/entryCandidate";
import { deriveFreshEntry } from "@/lib/runs/wizardEntry";
import type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";
import type { DashboardNewRunPrefill } from "@/lib/dashboardPrefillTypes";
import type { TrackOption } from "@/components/runs/TrackCombobox";
import type { ComponentProps } from "react";

/**
 * Log-run wizard host (v6, founder interview 2026-07-17: "prefill should
 * always be an option — never automatic"). The wizard ALWAYS lands blank; the
 * Session step's prefill/manifest card offers the selected car's last run and
 * a single tap applies it in-form (NewRunForm's applyWizardPrefill). There is
 * no staleness cutoff any more — an old run is still offered, honestly dated.
 *
 * "Start blank instead" (the applied card's undo) remounts the form via the
 * key for a clean slate (GPS venue auto-pick re-runs).
 */

type FormProps = ComponentProps<
  typeof import("@/components/runs/NewRunForm").NewRunForm
>;

export function LogRunWizardHost({
  entryCars,
  initialCandidate,
  currentEventId,
  drafts,
  cars,
  tracks,
  favouriteTrackIds,
  favouriteTracks,
  dashboardPrefill,
  initialCopyPreviewRun,
}: {
  entryCars: Array<{ id: string; name: string }>;
  initialCandidate: EntryCandidate | null;
  currentEventId: string | null;
  drafts: WizardDraftRow[];
  cars: FormProps["cars"];
  tracks: FormProps["tracks"];
  favouriteTrackIds: string[];
  favouriteTracks: TrackOption[];
  dashboardPrefill: DashboardNewRunPrefill | null;
  initialCopyPreviewRun: CopyPreviewRunRecord | null;
}) {
  // A candidate with no car can't be prefilled (nothing to copy from). Only
  // used as the manifest card's instant placeholder while the form's own
  // per-car last-run fetch resolves.
  const candidate = initialCandidate?.carId ? initialCandidate : null;
  const defaultCarId = entryCars[0]?.id ?? "";

  // Bumped by "Start blank instead" so the remount fully clears the run.
  const [restartSeq, setRestartSeq] = useState(0);

  const entry = useMemo(
    () => deriveFreshEntry(defaultCarId, currentEventId),
    [defaultCarId, currentEventId]
  );

  return (
    <NewRunForm
      key={`blank:${restartSeq}`}
      cars={cars}
      tracks={tracks}
      favouriteTrackIds={favouriteTrackIds}
      favouriteTracks={favouriteTracks}
      dashboardPrefill={dashboardPrefill}
      initialEventId={entry.eventId}
      initialCopyPreviewRun={initialCopyPreviewRun}
      wizard={entry}
      wizardCandidate={candidate}
      wizardDrafts={drafts}
      wizardDeepLinkedEventId={currentEventId}
      onWizardRestart={() => setRestartSeq((s) => s + 1)}
    />
  );
}
