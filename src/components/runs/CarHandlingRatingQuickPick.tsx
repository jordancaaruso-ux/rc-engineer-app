"use client";

import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { CAR_RATING_BANDS, carRatingBandCaption } from "@/lib/runHandlingAssessment";

/**
 * Car handling rating — 1–10, grouped into the four bands the Engineer actually reads
 * (docs/HANDLING_CAPTURE_NORTH_STAR.md).
 *
 * The scale stays 1–10 (founder 2026-07-08, re-confirmed 2026-07-26): the anchor drivers
 * use is **"how close is this to what I know perfect is"** — absolute, not "good for
 * today's grip" — which is exactly what `knownGoodMemory` assumes when it promotes a run
 * to a reference setup at ≥8. What was missing was never the resolution; it was that the
 * picker printed no anchor at all, so an unprompted driver rates "how my run went" and
 * quietly seeds the Engineer's references with good moods. Hence: the question is stated,
 * the bands are drawn, and the 8 boundary is called out.
 *
 * Visual: −21° skewed plates, the same brand cut as the corner-balance notches one swipe
 * away, the wizard bar and the page-title sector (globals.css). The plate is a layer
 * *behind* an upright numeral so the digit stays legible. Selected state uses
 * `chipToggleClass` — yellow is reserved for actions and must never encode data
 * (VISUAL_NORTH_STAR); this picker used to fill the selected number with brand yellow.
 */
type Props = {
  value: number | null;
  onChange?: (n: number) => void;
  readOnly?: boolean;
  /** Run complete was blocked — draw attention to this picker. */
  highlightMissing?: boolean;
};

export function CarHandlingRatingQuickPick({
  value,
  onChange,
  readOnly = false,
  highlightMissing = false,
}: Props) {
  const bandWord = value == null ? null : carRatingBandCaption(value);
  /** Band groups sized by how many numbers they hold, so every chip stays equal width. */
  const bandGrid = "grid grid-cols-[3fr_2fr_2fr_3fr] gap-3";

  return (
    <div
      className={cn(
        highlightMissing &&
          !readOnly &&
          "rounded-md ring-2 ring-amber-500/40 ring-offset-2 ring-offset-background"
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {readOnly ? "Car handling rating" : "How close to perfect was the car?"}
        </div>
        <div
          className={cn(
            "font-mono text-[11px] tabular-nums",
            highlightMissing && value == null && !readOnly
              ? "font-medium text-amber-700 dark:text-amber-300"
              : "text-muted-foreground"
          )}
        >
          {value == null
            ? highlightMissing && !readOnly
              ? "Pick a rating"
              : "Not rated"
            : `${value} / 10${bandWord ? ` · ${bandWord.toLowerCase()}` : ""}`}
        </div>
      </div>

      {/* Band captions sit over their own group — this is the anchor the scale never had. */}
      <div className={cn(bandGrid, "mt-2.5")} aria-hidden>
        {CAR_RATING_BANDS.map((band) => (
          <span key={band.caption} className="type-data-label text-center">
            {band.caption}
          </span>
        ))}
      </div>

      <div
        role="radiogroup"
        aria-label="Car handling rating 1 to 10"
        aria-readonly={readOnly || undefined}
        className={cn(bandGrid, "mt-1.5", readOnly && "pointer-events-none")}
      >
        {CAR_RATING_BANDS.map((band) => (
          <div key={band.caption} className="flex gap-[3px]">
            {band.ratings.map((n) => {
              const selected = value === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${n} out of 10 — ${band.caption.toLowerCase()}`}
                  disabled={readOnly}
                  tabIndex={readOnly ? -1 : undefined}
                  onClick={readOnly ? undefined : () => onChange?.(n)}
                  className="group relative flex h-11 flex-1 items-center justify-center rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    className={cn(
                      chipToggleClass(selected),
                      "absolute inset-0 -skew-x-[21deg] rounded-[3px]",
                      !selected && !readOnly && "group-hover:bg-muted/60",
                      highlightMissing &&
                        !selected &&
                        !readOnly &&
                        "border-amber-500/50 bg-amber-500/5"
                    )}
                  />
                  <span
                    className={cn(
                      "relative font-mono text-[12px] font-medium tabular-nums transition-colors duration-150",
                      selected ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* The 8 boundary changes what the app does with the run, so it stops being invisible. */}
      {!readOnly ? (
        <p className="ui-caption mt-2.5">
          8+ saves this setup as a reference the Engineer can bring back later.
        </p>
      ) : null}
    </div>
  );
}
