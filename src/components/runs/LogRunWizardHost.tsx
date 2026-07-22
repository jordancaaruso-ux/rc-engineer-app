"use client";

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { NewRunForm } from "@/components/runs/NewRunFormDynamic";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
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
  isFirstRun = false,
  homeTrackId = null,
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
  /** No runs logged yet — turns on the first-run coach line (one quiet line per step). */
  isFirstRun?: boolean;
  /** Favourited home track, used to seed the very first run's Session step. */
  homeTrackId?: string | null;
}) {
  // A candidate with no car can't be prefilled (nothing to copy from). Only
  // used as the manifest card's instant placeholder while the form's own
  // per-car last-run fetch resolves.
  const candidate = initialCandidate?.carId ? initialCandidate : null;
  const defaultCarId = entryCars[0]?.id ?? "";
  const hasNoCars = entryCars.length === 0;

  // Bumped by "Start blank instead" so the remount fully clears the run.
  const [restartSeq, setRestartSeq] = useState(0);

  const entry = useMemo(
    // Home track only seeds the very first run — see deriveFreshEntry.
    () => deriveFreshEntry(defaultCarId, currentEventId, isFirstRun ? homeTrackId : null),
    [defaultCarId, currentEventId, isFirstRun, homeTrackId]
  );

  // Runs belong to a car, so with none there is nothing this wizard can save.
  // It used to mount anyway: all six tabs walked, the bar kept promising
  // "Tires →", and Save sat disabled with no label saying why — the only
  // explanation was a card at the top of step 1 that scrolled away. Reached
  // straight from the dashboard's primary CTA and the mobile Log-run circle,
  // so it was the first thing a new account hit (2026-07-22).
  if (hasNoCars) {
    return (
      <CardPanel className="text-center" contentClassName="px-5 py-8">
        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-foreground">Add a car first</h2>
        <p className="mx-auto mt-2 max-w-[34ch] text-[13px] leading-relaxed text-muted-foreground">
          Runs attach to a car — it’s the one thing we can’t guess for you. Takes about twenty
          seconds, then you’re logging.
        </p>
        <ButtonLink href="/cars" className="mt-5 gap-1.5 px-4 py-2.5 text-sm">
          Add your car
          <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
        </ButtonLink>
      </CardPanel>
    );
  }

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
      wizardFirstRun={isFirstRun}
      onWizardRestart={() => setRestartSeq((s) => s + 1)}
    />
  );
}
