import { CAR_RATING_BANDS, carRatingBandCaption } from "@/lib/runHandlingAssessment";
import { cn } from "@/lib/utils";

/**
 * RatingDial — a circular arc for ONE bounded magnitude, sized from a single `size`
 * prop (design handoff "Desktop Dashboard + RatingDial", 2026-08-08).
 *
 * It replaces the "Rating / 7 / 10" label-and-number tile: same information in a 44px
 * glyph, plus the verdict word the bare numeral never carried.
 *
 * Two modes:
 *   verdict — 0…max, filled clockwise from 12 o'clock, coloured by the car-rating ramp.
 *   axis    — a signed magnitude either side of a centre, filled out of 12 o'clock in
 *             whichever direction it leans, always accent yellow.
 *
 * The accent in axis mode is the design system's SINGLE signed-off exception to
 * "yellow is never data" (VISUAL_NORTH_STAR.md), and it does not generalise: it is a
 * magnitude on a measured axis, not a verdict.
 *
 * The ramp is NOT the one in the handoff. That document groups 8 as "Dialled"; this app's
 * `CAR_RATING_BANDS` (regrouped 2026-08-03, founder-locked, and flagged in-source as "not
 * drift to be fixed") puts 7–8 in "Good" and reserves "Dialled" for 9–10. Bands and words
 * are read from that constant so the dial cannot drift from the rating picker the driver
 * actually taps. Colours come from the `--color-rating-*` tokens keyed by band caption,
 * which is how the picker resolves them too.
 *
 * Pure and server-safe — no hooks, no client boundary. Read-only by design; tap-to-rate is
 * explicitly out of scope for v1.
 */

const RATING_MIN = 1;
const RATING_MAX = 10;

/** Band caption → ramp token, keyed by caption so a regroup can't desync it. */
const BAND_TOKEN: Record<string, string> = {
  Bad: "--color-rating-bad",
  Workable: "--color-rating-workable",
  Good: "--color-rating-good",
  Dialled: "--color-rating-dialled",
};

function bandColorFor(value: number): string {
  const caption = carRatingBandCaption(Math.round(value));
  const token = caption ? BAND_TOKEN[caption] : undefined;
  return `rgb(var(${token ?? "--color-muted-foreground"}))`;
}

export type RatingDialProps = {
  mode?: "verdict" | "axis";
  /** null / NaN renders the unrated state — a dashed track and an en-dash. */
  value: number | null | undefined;
  min?: number;
  max?: number;
  /** Axis only. Defaults to the midpoint of min…max. */
  centre?: number;
  size?: number;
  /** Overrides the numeral inside the ring, e.g. "TGT" or "98%". */
  display?: string;
  /** true → the band word; a string → that word verbatim. */
  word?: boolean | string;
  caption?: string;
  /** Used to build the text equivalent — "Handling 8 of 10 — Good". */
  label?: string;
  className?: string;
};

export function RatingDial({
  mode = "verdict",
  value,
  min = 0,
  max = 10,
  centre,
  size = 44,
  display,
  word,
  caption,
  label = "Rating",
  className,
}: RatingDialProps) {
  const isAxis = mode === "axis";
  const raw = typeof value === "number" ? value : Number.NaN;
  const rated = Number.isFinite(raw);

  const resolvedCentre = Number.isFinite(centre as number)
    ? (centre as number)
    : isAxis
      ? (min + max) / 2
      : min;

  const clamped = rated ? Math.min(max, Math.max(min, raw)) : resolvedCentre;
  const span = (isAxis ? max - resolvedCentre : max - min) || 1;
  const fraction = rated ? Math.min(1, Math.abs(clamped - resolvedCentre) / span) : 0;

  const stroke = size <= 26 ? 2.5 : size <= 36 ? 3 : size <= 52 ? 4 : 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const mid = size / 2;
  const len = circumference * fraction;

  // Axis mode leans anticlockwise below centre, so the arc reads as a direction.
  const leansNegative = isAxis && clamped < resolvedCentre;
  const fillRotation = leansNegative ? -(fraction * 360) : 0;

  const arcColor = !rated
    ? "rgb(var(--color-rating-unrated))"
    : isAxis
      ? "rgb(var(--color-primary))"
      : bandColorFor(clamped);

  const bandWord = rated ? (carRatingBandCaption(Math.round(clamped)) ?? "") : "Unrated";
  const wordText = typeof word === "string" ? word : isAxis ? "" : bandWord;
  const showText = Boolean(wordText) || Boolean(caption);

  const numeral = size >= 28;
  const numeralText = display ?? (rated ? String(clamped) : "–");
  // Three steps, not two: a five-character display like "99.4%" runs into the ring at the
  // 0.26 ratio, and the ring is the thing that must not be touched.
  const numeralRatio = numeralText.length >= 5 ? 0.21 : numeralText.length > 2 ? 0.26 : 0.34;
  const numeralSize = Math.max(9, Math.round(size * numeralRatio));
  const wordSize = Math.max(11, Math.round(size * 0.26));
  const captionSize = Math.max(10, Math.round(size * 0.2));
  const textGap = Math.round(size * 0.24);

  // The arc alone is not accessible — every dial carries the reading as text.
  const readOut = rated
    ? isAxis
      ? `${label} ${clamped}`
      : `${label} ${clamped} of ${max}${bandWord ? ` — ${bandWord}` : ""}`
    : `${label} — not rated`;

  return (
    <div
      className={cn("flex items-center", className)}
      style={{ gap: showText ? textGap : 0 }}
      title={readOut}
    >
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={readOut}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ display: "block", transform: "rotate(-90deg)" }}
          aria-hidden
        >
          <circle
            cx={mid}
            cy={mid}
            r={radius}
            fill="none"
            stroke="rgb(var(--color-border))"
            strokeWidth={stroke}
            // Unrated reads as an empty socket rather than a zeroed value.
            strokeDasharray={rated ? undefined : `${stroke * 1.6} ${stroke * 1.6}`}
          />
          <circle
            cx={mid}
            cy={mid}
            r={radius}
            fill="none"
            stroke={arcColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${len.toFixed(2)} ${(circumference - len).toFixed(2)}`}
            transform={`rotate(${fillRotation.toFixed(2)} ${mid} ${mid})`}
          />
          {isAxis ? (
            // Neutral marker at 12 o'clock, punched in the page tone so it reads as a gap.
            <line
              x1={mid}
              y1={mid - radius - stroke / 2}
              x2={mid}
              y2={mid - radius + stroke / 2}
              stroke="var(--page-bg-base)"
              strokeWidth={1.5}
              transform={`rotate(90 ${mid} ${mid})`}
            />
          ) : null}
        </svg>
        {numeral ? (
          <span
            className="absolute inset-0 flex items-center justify-center font-medium tabular-nums"
            style={{
              fontSize: numeralSize,
              letterSpacing: "-.03em",
              color: rated ? "rgb(var(--color-foreground))" : "rgb(var(--color-faint))",
            }}
          >
            {numeralText}
          </span>
        ) : null}
      </div>

      {showText ? (
        <span className="min-w-0">
          {wordText ? (
            <span
              className="block font-semibold"
              style={{
                fontSize: wordSize,
                letterSpacing: "-.01em",
                color: isAxis ? "rgb(var(--color-foreground))" : arcColor,
              }}
            >
              {wordText}
            </span>
          ) : null}
          {caption ? (
            <span
              className="mt-0.5 block leading-[1.3] text-faint"
              style={{ fontSize: captionSize }}
            >
              {caption}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Exported so callers can label a rating without re-deriving the band. */
export { CAR_RATING_BANDS, RATING_MIN, RATING_MAX };
