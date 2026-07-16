"use client";

import { useState } from "react";
import { NewRunForm } from "@/components/runs/NewRunFormDynamic";
import { LogRunEntry, type EntryDraftRow, type EntryTrack } from "@/components/runs/LogRunEntry";
import type { EntryCandidate } from "@/lib/runs/entryCandidate";
import type { NewRunWizardEntry } from "@/lib/runs/wizardEntry";
import type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";
import type { DashboardNewRunPrefill } from "@/lib/dashboardPrefillTypes";
import type { TrackOption } from "@/components/runs/TrackCombobox";

/**
 * Flag-gated Log-run wizard host (rework 2026-07-16 v2): page 1 is the entry
 * screen (session context → event/track → car → open drafts → explicit
 * Copy/Fresh with "what changed" chips); Continue mounts NewRunForm in wizard
 * mode with the resolved payload. Back on the wizard's first step returns here
 * (the form remounts fresh on re-entry).
 */

type FormProps = Parameters<typeof NewRunForm>[0];

export function LogRunWizardHost({
  entryCars,
  entryTracks,
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
  entryTracks: EntryTrack[];
  initialCandidate: EntryCandidate | null;
  currentEventId: string | null;
  drafts: EntryDraftRow[];
  cars: FormProps["cars"];
  tracks: FormProps["tracks"];
  favouriteTrackIds: string[];
  favouriteTracks: TrackOption[];
  dashboardPrefill: DashboardNewRunPrefill | null;
  initialCopyPreviewRun: CopyPreviewRunRecord | null;
}) {
  const [entry, setEntry] = useState<NewRunWizardEntry | null>(null);

  if (!entry) {
    return (
      <LogRunEntry
        cars={entryCars}
        tracks={entryTracks}
        favouriteTrackIds={favouriteTrackIds}
        favouriteTracks={favouriteTracks}
        initialCandidate={initialCandidate}
        currentEventId={currentEventId}
        drafts={drafts}
        onContinue={setEntry}
      />
    );
  }

  return (
    <NewRunForm
      // Remount per entry so re-entering with different choices starts clean.
      key={`${entry.carId}:${entry.continuing}:${entry.changed.join(",")}:${entry.eventId ?? ""}:${entry.trackId ?? ""}`}
      cars={cars}
      tracks={tracks}
      favouriteTrackIds={favouriteTrackIds}
      favouriteTracks={favouriteTracks}
      dashboardPrefill={dashboardPrefill}
      initialEventId={entry.eventId}
      initialCopyPreviewRun={initialCopyPreviewRun}
      wizard={entry}
      onExitWizard={() => setEntry(null)}
    />
  );
}
