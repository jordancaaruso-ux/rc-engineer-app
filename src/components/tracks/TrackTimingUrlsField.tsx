"use client";

import { forwardRef, useImperativeHandle, useId, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TRACK_TIMING_PASTE_EXAMPLES,
  classifyTrackTimingUrl,
  type TrackTimingUrls,
} from "@/lib/tracks/trackTimingUrl";

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
  }
>(function TrackTimingUrlsField(
  { value, onChange, onError, inputClassName, labelClassName, className },
  ref
) {
  const [draft, setDraft] = useState("");
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

  useImperativeHandle(ref, () => ({
    commit: () => (draft.trim() ? addDraft() : { ok: true, value }),
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
                {displayUrl(field, value[field] ?? "")}
              </span>
              <button
                type="button"
                aria-label={`Remove the ${PROVIDER_LABEL[field]} page`}
                onClick={() => {
                  onChange({ ...value, [field]: null });
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
        <input
          id={fieldId}
          // Deliberately not type="url" — a bare host is what drivers paste, and the browser's
          // own validation would reject it before submit. classifyTrackTimingUrl adds the scheme.
          type="text"
          inputMode="url"
          autoComplete="off"
          className={inputClassName}
          placeholder={
            filled.length > 0 ? "Paste another timing page" : "LiveRC or Speedhive page URL"
          }
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // Inside a <form> either side of this, so never let Enter submit the whole thing.
            e.preventDefault();
            if (!draft.trim()) return;
            const added = addDraft();
            if (!added.ok) onError(added.error);
          }}
        />
      )}

      {/* Only argues the case while there's still a case to argue. Once a page is in, "you
          can skip it" is answering a question the driver has already settled. */}
      {filled.length > 0 ? null : (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Adding one lets us find your sessions automatically. You can skip it. Without one
          you&apos;ll paste a results link for each run instead.
          {/* The example holds an unbroken URL — without break-words it overflows the panel
              and the second provider is clipped off the line. */}
          <span className="block break-words opacity-80">{TRACK_TIMING_PASTE_EXAMPLES}</span>
        </p>
      )}
    </div>
  );
});
