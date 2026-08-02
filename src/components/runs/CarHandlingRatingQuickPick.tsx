"use client";

import { cn } from "@/lib/utils";
import { CAR_RATING_BANDS, carRatingBandCaption } from "@/lib/runHandlingAssessment";

/**
 * Car handling rating — 1–10, grouped into the four bands the Engineer actually reads
 * (docs/HANDLING_CAPTURE_NORTH_STAR.md).
 *
 * The scale stays 1–10 (founder 2026-07-08, re-confirmed 2026-07-26): the anchor drivers
 * use is **"how close is this to what I know perfect is"** — absolute, not "good for
 * today's grip" — which is exactly what `knownGoodMemory` assumes when it promotes a run
 * to a reference setup at ≥8.
 *
 * Visual (founder review 2026-08-02, three rounds of live A/B):
 * - **Band blocks, not ten plates.** The band is the unit of meaning, so it's the unit of
 *   drawing: four blocks sized to how many numbers they hold, each carrying its own colour
 *   from the rating ramp (`--color-rating-*` in globals.css). Colour tells you which band
 *   you're in before you read the number.
 * - **The −21° skew is gone here.** Skewed plates in a ~30px column read as tall slivers,
 *   and the lean on the end plates was clipped by the panel edge — the brand cut needs
 *   room it doesn't have at this size. It survives elsewhere (wizard bar, page title).
 * - **Numerals are Sora 600, not JetBrains Mono.** A deliberate exception to
 *   VISUAL_NORTH_STAR's "prefer font-mono for numeric data": mono at this size went thin
 *   and undersized inside the block, and these are one-glyph labels on a control, not
 *   tabular data being compared down a column. `tabular-nums` still holds the width.
 * - Yellow is still nowhere near this control — it stays reserved for actions.
 */
type Props = {
  value: number | null;
  onChange?: (n: number) => void;
  readOnly?: boolean;
  /** Run complete was blocked — draw attention to this picker. */
  highlightMissing?: boolean;
};

/** Band caption → ramp token. Kept keyed by caption so it can't drift from CAR_RATING_BANDS. */
const BAND_TOKEN: Record<string, string> = {
  Bad: "--color-rating-bad",
  Workable: "--color-rating-workable",
  Good: "--color-rating-good",
  Dialled: "--color-rating-dialled",
};

function bandColor(caption: string, alpha?: number): string {
  const token = BAND_TOKEN[caption] ?? "--color-muted-foreground";
  return `rgb(var(${token})${alpha == null ? "" : ` / ${alpha}`})`;
}

export function CarHandlingRatingQuickPick({
  value,
  onChange,
  readOnly = false,
  highlightMissing = false,
}: Props) {
  const bandWord = value == null ? null : carRatingBandCaption(value);
  /** Band groups sized by how many numbers they hold, so every cell stays equal width. */
  const bandGrid = "grid grid-cols-[3fr_2fr_2fr_3fr] gap-1.5";
  const missing = value == null && highlightMissing && !readOnly;

  return (
    <div
      className={cn(
        highlightMissing &&
          !readOnly &&
          "rounded-md ring-2 ring-amber-500/40 ring-offset-2 ring-offset-background"
      )}
    >
      <div className="text-xs font-medium text-muted-foreground">
        {readOnly ? "Car handling rating" : "How close to perfect was the car?"}
      </div>

      <div className="mt-2.5 flex items-end gap-3">
        <div
          role="radiogroup"
          aria-label="Car handling rating 1 to 10"
          aria-readonly={readOnly || undefined}
          className={cn(bandGrid, "min-w-0 flex-1", readOnly && "pointer-events-none")}
        >
          {CAR_RATING_BANDS.map((band) => {
            const bandActive = bandWord === band.caption;
            return (
              <div key={band.caption}>
                <div className="flex gap-px overflow-hidden rounded-md">
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
                        style={
                          selected
                            ? {
                                background: bandColor(band.caption),
                                color: "rgb(var(--color-background))",
                              }
                            : undefined
                        }
                        className={cn(
                          "h-9 flex-1 font-sans text-[13px] font-semibold tabular-nums",
                          "transition-colors duration-150",
                          "focus-visible:relative focus-visible:z-10 focus-visible:outline-none",
                          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          !selected &&
                            (bandActive
                              ? "bg-muted text-foreground"
                              : "bg-secondary text-muted-foreground"),
                          !selected && !readOnly && "hover:bg-muted hover:text-foreground",
                          !selected &&
                            missing &&
                            "bg-amber-500/5 text-amber-700 dark:text-amber-300"
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
                <div
                  aria-hidden
                  style={bandActive ? { color: bandColor(band.caption) } : undefined}
                  className={cn(
                    "mt-1 text-center font-sans text-[10px] font-semibold tracking-tight transition-colors duration-150",
                    !bandActive && "text-faint"
                  )}
                >
                  {band.caption}
                </div>
              </div>
            );
          })}
        </div>

        {/* Instrument readout. Sized so a two-digit 10 never reflows the block grid. */}
        <div className="w-[62px] shrink-0 pb-4 text-right">
          <span
            style={bandWord ? { color: bandColor(bandWord) } : undefined}
            className={cn(
              "font-sans text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums",
              !bandWord && (missing ? "text-amber-700 dark:text-amber-300" : "text-faint")
            )}
          >
            {value ?? "—"}
          </span>
          <span className="font-sans text-xs font-medium text-faint">{value == null ? "" : " / 10"}</span>
          <div
            className={cn(
              "mt-0.5 font-sans text-[11px] font-semibold tracking-tight",
              missing ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"
            )}
          >
            {bandWord ?? (missing ? "Pick a rating" : "Not rated")}
          </div>
        </div>
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
