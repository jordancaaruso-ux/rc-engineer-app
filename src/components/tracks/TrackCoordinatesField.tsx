"use client";

import { forwardRef, useImperativeHandle, useId, useState } from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseCoordinatesPaste } from "@/lib/location/parseCoordinatesPaste";
import { getCurrentPosition, GeolocationRequestError } from "@/lib/location/getCurrentPosition";

/**
 * Collects a track's GPS pin while the track is being created.
 *
 * Until 2026-08-25 the only coordinates input in the app lived on the *existing* track's page
 * (TrackLocationEditor), so a track born from the run form or the catalog's add row started with
 * no pin at all — and the two things that need one, "tracks near you" on Log run and the nearby
 * browse on the catalog page, could not see it. The driver adding the track is usually standing
 * at it, which makes this the one moment the pin is free to collect.
 *
 * Two ways in, because both are true at different times: "Use my location" for the driver at the
 * track, a paste for the one adding a venue from the couch (Google Maps → right-click the pin →
 * copy). Optional in both forms — a track with a name and no pin is still worth having.
 */

export type TrackCoordinatesValue = {
  latitude: number;
  longitude: number;
  /** Mirrors the PATCH route's vocabulary so the two paths store the same provenance. */
  locationSource: "manual_paste" | "device";
};

export type TrackCoordinatesFieldHandle = {
  /**
   * Fold a half-typed paste into the value at submit time — most people never press Enter.
   * Returns the value to send, or the error to show instead of saving.
   */
  commit: () => { ok: true; value: TrackCoordinatesValue | null } | { ok: false; error: string };
};

export const TrackCoordinatesField = forwardRef<
  TrackCoordinatesFieldHandle,
  {
    value: TrackCoordinatesValue | null;
    onChange: (next: TrackCoordinatesValue | null) => void;
    /** Surface the error where this form already shows its messages. */
    onError: (error: string | null) => void;
    inputClassName: string;
    labelClassName?: string;
    className?: string;
  }
>(function TrackCoordinatesField(
  { value, onChange, onError, inputClassName, labelClassName, className },
  ref
) {
  const [draft, setDraft] = useState("");
  const [locating, setLocating] = useState(false);
  const fieldId = useId();

  function addDraft():
    | { ok: true; value: TrackCoordinatesValue | null }
    | { ok: false; error: string } {
    const parsed = parseCoordinatesPaste(draft);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    const next: TrackCoordinatesValue = {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      locationSource: "manual_paste",
    };
    onChange(next);
    setDraft("");
    onError(null);
    return { ok: true, value: next };
  }

  function commitDraft() {
    if (!draft.trim()) return;
    const added = addDraft();
    if (!added.ok) onError(added.error);
  }

  async function fillFromDevice() {
    setLocating(true);
    onError(null);
    try {
      const position = await getCurrentPosition();
      onChange({
        latitude: position.latitude,
        longitude: position.longitude,
        locationSource: "device",
      });
      setDraft("");
    } catch (e) {
      if (e instanceof GeolocationRequestError) onError(e.message);
      else onError(e instanceof Error ? e.message : "Could not get your location");
    } finally {
      setLocating(false);
    }
  }

  useImperativeHandle(ref, () => ({
    commit: () => (draft.trim() ? addDraft() : { ok: true, value }),
  }));

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={fieldId} className={labelClassName}>
        GPS location — optional
      </label>

      {value ? (
        <div className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-runna-inset px-2 py-1">
          <MapPin aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.4} />
          <span className="min-w-0 break-all fig-stat text-[11px] text-foreground">
            {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}
          </span>
          <button
            type="button"
            aria-label="Remove these coordinates"
            onClick={() => {
              onChange(null);
              onError(null);
            }}
            className="shrink-0 rounded text-muted-foreground transition hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" strokeWidth={2.6} />
          </button>
        </div>
      ) : (
        // The caller's `inputClassName` dresses the whole row and the input inside goes bare —
        // one box on screen, same composition as TrackTimingUrlsField beside it.
        <div className={cn("search-row-composite flex items-center gap-1.5", inputClassName)}>
          <input
            id={fieldId}
            type="text"
            inputMode="text"
            autoComplete="off"
            // No placeholder: colour here on purpose. `text-muted-foreground` is a solid,
            // contrast-tuned grey meant for real copy, and against the plain boxes above — which
            // take the app-wide default of foreground at 50% — it rendered noticeably heavier, so
            // the hint read as a value already typed in (founder, 2026-08-25). Letting the default
            // apply makes every box in the form say "empty" with the same weight.
            className="min-w-0 flex-1 bg-transparent outline-none"
            // Prefixed "e.g." like the Name and Town boxes above it. Bare, the number reads as a
            // value somebody already typed rather than the shape one should take.
            placeholder="e.g. -37.75347, 145.13890"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Inside a <form> either side of this, so never let Enter submit the whole thing.
              e.preventDefault();
              commitDraft();
            }}
          />
          <button
            type="button"
            onClick={() => void fillFromDevice()}
            disabled={locating}
            aria-label="Use my current location"
            title="Use my current location"
            className={cn(
              "tap-active -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-primary-ink/45 text-primary-ink transition hover:bg-primary/15",
              locating && "opacity-50 pointer-events-none"
            )}
          >
            <MapPin className="size-4" strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      )}

      {value ? null : (
        <p className="break-words text-[11px] leading-snug text-muted-foreground">
          Puts the track on “near you” for every driver. Tap the pin if you’re here, or paste from
          Google Maps.
        </p>
      )}
    </div>
  );
});
