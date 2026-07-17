"use client";

import { useMemo, useState } from "react";
import { NewRunForm } from "@/components/runs/NewRunFormDynamic";
import type { WizardDraftRow } from "@/components/runs/WizardStartControls";
import type { EntryCandidate } from "@/lib/runs/entryCandidate";
import {
  deriveContinueEntry,
  deriveFreshEntry,
  isCandidateStale,
} from "@/lib/runs/wizardEntry";
import type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";
import type { DashboardNewRunPrefill } from "@/lib/dashboardPrefillTypes";
import type { TrackOption } from "@/components/runs/TrackCombobox";

/**
 * Log-run wizard host (v4, founder interview 2026-07-17 evening): no
 * pre-choice entry phase. The form IS the wizard from step 1 — it mounts
 * immediately on the Session step with every tab live, and the start context
 * is derived here, synchronously:
 *
 * - Recent last run (≤14 days) → **pre-continued**: the run lands already
 *   carrying that run's context, zero taps. The Session step shows the
 *   "Continued from run X" status + a New-log switch.
 * - Stale / no last run → blank new log (GPS fills the track in-form).
 *
 * Switching modes remounts the form via the key (after the switch row's
 * two-tap confirm — it discards what's entered).
 */

type FormProps = Parameters<typeof NewRunForm>[0];

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
  // A candidate with no car can't be continued (nothing to copy from).
  const candidate = initialCandidate?.carId ? initialCandidate : null;
  const defaultCarId = entryCars[0]?.id ?? "";

  // Contextual default, decided once at mount: continue only while the last
  // run is recent. (Initializer runs once — the 14-day boundary crossing
  // between server and client render is a non-issue.)
  const [mode, setMode] = useState<"continued" | "fresh">(() =>
    candidate && !isCandidateStale(candidate) ? "continued" : "fresh"
  );
  // Bumped on every explicit switch so re-picking the same mode still remounts.
  // (The auto-vs-manual copy wording retired 2026-07-17 late — the state reads
  // the same however it landed.)
  const [switchSeq, setSwitchSeq] = useState(0);

  const entry = useMemo(
    () =>
      mode === "continued" && candidate
        ? deriveContinueEntry(candidate, currentEventId)
        : deriveFreshEntry(defaultCarId, currentEventId),
    [mode, candidate, currentEventId, defaultCarId]
  );

  return (
    <NewRunForm
      key={`${mode}:${switchSeq}`}
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
      onWizardRestart={(m) => {
        setMode(m);
        setSwitchSeq((s) => s + 1);
      }}
    />
  );
}
