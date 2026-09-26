"use client";

import { forwardRef, useImperativeHandle, useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TRACK_TIMING_PASTE_EXAMPLE_SHORT,
  classifyTrackTimingUrl,
  type TrackTimingUrls,
} from "@/lib/tracks/trackTimingUrl";
import { tidyName } from "@/lib/tracks/tidyTrackName";

/**
 * Collects a track's timing pages — plural, because a track holds one LiveRC slot and one
 * Speedhive slot and discovery searches both at once.
 *
 * The split that makes both worth having is practice on Speedhive, race weekends on LiveRC.
 * A single box that saved one and then never asked again left those venues half-entered, so
 * this keeps taking pastes until both slots are full. Each paste is sorted by host
 * (classifyTrackTimingUrl), so the driver never picks a provider — they just paste what they
 * read off the club's page.
 *
 * Neither slot is a per-day link: LiveRC is trimmed to the track's site and Speedhive to the
 * club's practice or organization page. A link that changes day to day is a different job,
 * handled per run under "URL Manual" and per event by the event's own source URLs.
 */

export type TrackTimingUrlsFieldHandle = {
  /**
   * Fold a half-typed paste into the value at submit time — most people never press Enter.
   * Returns the value to send, or the error to show instead of saving.
   */
  commit: () => { ok: true; value: TrackTimingUrls } | { ok: false; error: string };
  /**
   * Take the club picked in the form's "Find on Speedhive" (`speedhiveLookup`): fills the Speedhive
   * slot, and renames the track to Speedhive's name.
   */
  pickSpeedhive: (speedhiveUrl: string, pickedName: string) => void;
};

const PROVIDER_LABEL: Record<keyof TrackTimingUrls, string> = {
  liveRcUrl: "LiveRC",
  speedhiveUrl: "Speedhive",
};

/**
 * Chips drop what the provider name already said. A LiveRC subdomain *is* the track's
 * identity so the host stays; a Speedhive host is the same for every track, so only the
 * part that identifies the club is worth the width ("practice/4591").
 */
function displayUrl(field: keyof TrackTimingUrls, url: string): string {
  const bare = url.replace(/^https?:\/\//i, "");
  if (field !== "speedhiveUrl") return bare;
  const path = bare.replace(/^[^/]+\//, "");
  return path && path !== bare ? path : bare;
}

export const TrackTimingUrlsField = forwardRef<
  TrackTimingUrlsFieldHandle,
  {
    value: TrackTimingUrls;
    onChange: (next: TrackTimingUrls) => void;
    /** Surface the error where this form already shows its messages. */
    onError: (error: string | null) => void;
    inputClassName: string;
    labelClassName?: string;
    className?: string;
    /**
     * The name typed into an add-track form that offers "Find on Speedhive" for the track being
     * added — so the Speedhive link goes in with the track, instead of saving the track, opening it
     * and finding the link there (founder 2026-09-16). The form draws the finder itself, right
     * under its name box (founder pick 2026-09-26), and hands the pick to `pickSpeedhive`.
     *
     * Picking a club also hands its Speedhive name back to replace what was typed: the timing
     * site's name is the track's name, same rule as LiveRC's (founder 2026-09-16). Taking the
     * Speedhive chip off puts the typed name back.
     */
    speedhiveLookup?: {
      name: string;
      onNameChange: (name: string) => void;
    };
  }
>(function TrackTimingUrlsField(
  { value, onChange, onError, inputClassName, labelClassName, className, speedhiveLookup },
  ref
) {
  const [draft, setDraft] = useState("");
  /** Practice-page URL → the Speedhive name picked for it, so its chip names the club, not an id. */
  const [pickedNames, setPickedNames] = useState<Record<string, string>>({});
  /**
   * The name as typed before a pick renamed it. Taking the Speedhive link back off (the wrong club)
   * puts the typed name back too — unless the driver has since edited the name themselves.
   */
  const [renamedFrom, setRenamedFrom] = useState<{ typed: string; picked: string } | null>(null);
  const fieldId = useId();

  const filled = (Object.keys(PROVIDER_LABEL) as (keyof TrackTimingUrls)[]).filter(
    (field) => value[field]
  );
  const bothFilled = filled.length === 2;

  /** Sort one paste into its slot. Same provider twice replaces, visibly, via its chip. */
  function addDraft(): { ok: true; value: TrackTimingUrls } | { ok: false; error: string } {
    const parsed = classifyTrackTimingUrl(draft);
    if (!parsed.ok) return parsed;
    const next = { ...value, [parsed.field]: parsed.url };
    onChange(next);
    setDraft("");
    onError(null);
    return { ok: true, value: next };
  }

  /** Enter and the "+" take the same path, errors included, so they can't drift apart. */
  function commitDraft() {
    if (!draft.trim()) return;
    const added = addDraft();
    if (!added.ok) onError(added.error);
  }

  useImperativeHandle(ref, () => ({
    commit: () => (draft.trim() ? addDraft() : { ok: true, value }),
    pickSpeedhive: (speedhiveUrl, pickedName) => {
      // "PEAKHURST PARKWAY" goes in as "Peakhurst Parkway" — the same tidy LiveRC names get.
      const name = tidyName(pickedName);
      setPickedNames((cur) => ({ ...cur, [speedhiveUrl]: name }));
      onChange({ ...value, speedhiveUrl });
      if (speedhiveLookup && name && name !== speedhiveLookup.name) {
        setRenamedFrom({ typed: speedhiveLookup.name, picked: name });
        speedhiveLookup.onNameChange(name);
      }
      onError(null);
    },
  }));

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={fieldId} className={labelClassName}>
        Timing pages — optional
      </label>

      {filled.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {filled.map((field) => (
            <li
              key={field}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-runna-inset px-2 py-1"
            >
              <span className="shrink-0 text-[11px] font-bold text-foreground">
                {PROVIDER_LABEL[field]}
              </span>
              <span className="min-w-0 break-all text-[11px] text-muted-foreground">
                {(field === "speedhiveUrl" && pickedNames[value[field] ?? ""]) ||
                  displayUrl(field, value[field] ?? "")}
              </span>
              <button
                type="button"
                aria-label={`Remove the ${PROVIDER_LABEL[field]} page`}
                onClick={() => {
                  onChange({ ...value, [field]: null });
                  if (
                    field === "speedhiveUrl" &&
                    speedhiveLookup &&
                    renamedFrom &&
                    speedhiveLookup.name === renamedFrom.picked
                  ) {
                    speedhiveLookup.onNameChange(renamedFrom.typed);
                  }
                  if (field === "speedhiveUrl") setRenamedFrom(null);
                  onError(null);
                }}
                className="shrink-0 rounded text-muted-foreground transition hover:text-foreground"
              >
                <X aria-hidden className="size-3.5" strokeWidth={2.6} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {bothFilled ? null : (
        // The caller's `inputClassName` dresses the whole row, and the input inside it goes bare:
        // one box on screen, which is what `search-row-composite` is for — without it the global
        // input focus ring draws a second border inside this one.
        <div className={cn("search-row-composite flex items-center gap-1.5", inputClassName)}>
          <input
            id={fieldId}
            // Deliberately not type="url" — a bare host is what drivers paste, and the browser's
            // own validation would reject it before submit. classifyTrackTimingUrl adds the scheme.
            type="text"
            inputMode="url"
            autoComplete="off"
            // No placeholder: colour here on purpose. `text-muted-foreground` is a solid,
            // contrast-tuned grey meant for real copy, and against the plain boxes above — which
            // take the app-wide default of foreground at 50% — it rendered noticeably heavier, so
            // the hint read as a value already typed in (founder, 2026-08-25). Letting the default
            // apply makes every box in the form say "empty" with the same weight.
            className="min-w-0 flex-1 bg-transparent outline-none"
            placeholder={
              filled.length > 0 ? "Paste another timing page" : "LiveRC or Speedhive page URL"
            }
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Inside a <form> either side of this, so never let Enter submit the whole thing.
              e.preventDefault();
              commitDraft();
            }}
          />
          {/*
           * Enter has always added the paste, and so has pressing "Add track" — but a driver
           * looking at a lone text box has no reason to believe either, least of all on a phone
           * where the keyboard's return key is the thing that usually submits a form. The "+" is
           * the visible version of a rule that was only ever implied.
           *
           * Dimmed while empty rather than disabled: a disabled button can't be focused, so the
           * one affordance saying "this field takes more than one" would vanish for keyboard and
           * screen-reader users exactly when it's needed. `addDraft` already no-ops on an empty box.
           */}
          <button
            type="button"
            onClick={commitDraft}
            aria-label="Add this timing page"
            title="Add this timing page"
            className={cn(
              "tap-active -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-primary-ink/45 text-primary-ink transition hover:bg-primary/15",
              !draft.trim() && "opacity-40"
            )}
          >
            <Plus className="size-4" strokeWidth={2.75} aria-hidden />
          </button>
        </div>
      )}

      {/* The example is the whole hint — the "your sessions then turn up here" sentence came off
          with the other track-form blurbs (founder 2026-09-16). */}
      {filled.length > 0 ? null : (
        <p className="break-words text-[11px] leading-snug text-muted-foreground opacity-75">
          {TRACK_TIMING_PASTE_EXAMPLE_SHORT}
        </p>
      )}

    </div>
  );
});
