import { cn } from "@/lib/utils";
import {
  formatTireIndicatorTitle,
  type RunTireIndicator,
} from "@/lib/runs/tireSetChange";

/**
 * The tire mark: a ring with the set's run count in the middle ("1" = fresh
 * rubber, "4" = fourth run on it). Bright when the set changed vs the previous
 * same-car run, faint when it's the same set still going.
 *
 * The count sits *inside* the ring. It used to hang off the corner of a lucide
 * `Disc`, which pulled the glyph's visual weight sideways — fine in isolation,
 * wrong in a row or a chart column, where every marker then looked slightly
 * out of line with the thing it belonged to. It also meant one glyph carried two
 * greys, because the badge and the disc took different tokens.
 *
 * One weight everywhere: `TIRE_MARK_STROKE` is px on screen, and the session
 * trend chart derives its wrench stroke from it so both rows of its marker gutter
 * weigh the same.
 */
export const TIRE_MARK_STROKE = 1.5;

/**
 * The glyph as bare SVG children, for callers already inside an `<svg>` — the
 * trend chart draws it on plot coordinates. Colour comes from `currentColor`, so
 * the caller owns the bright/faint decision the same way the DOM wrapper does.
 */
export function TireMarkGlyph({
  indicator,
  cx,
  cy,
  size,
}: {
  indicator: RunTireIndicator;
  cx: number;
  cy: number;
  size: number;
}) {
  const label = indicator.runNumber != null ? String(indicator.runNumber) : null;
  return (
    <>
      <circle
        cx={cx}
        cy={cy}
        r={size / 2 - TIRE_MARK_STROKE / 2}
        fill="none"
        stroke="currentColor"
        strokeWidth={TIRE_MARK_STROKE}
      />
      {label ? (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={label.length > 1 ? size * 0.44 : size * 0.52}
          className="fill-current font-mono font-medium tabular-nums"
        >
          {label}
        </text>
      ) : (
        // No count to show — a hub dot keeps it a wheel instead of a bare circle.
        <circle cx={cx} cy={cy} r={TIRE_MARK_STROKE} fill="currentColor" />
      )}
    </>
  );
}

/**
 * Tire state at a glance for a run row. Presentational only — sessions rows wrap
 * it in a button that toggles the tire-prep panel.
 */
export function TireIndicatorIcon({
  indicator,
  size = "md",
  well = false,
  className,
}: {
  indicator: RunTireIndicator;
  /** lg = 28px slot / 20px ring (session-trend markers); md = 32px slot (mobile rows / cards); sm = 24px slot (desktop table rows). */
  size?: "sm" | "md" | "lg";
  /** Sit the icon on a bordered charcoal tile matching the adjacent action buttons (mobile action row). */
  well?: boolean;
  className?: string;
}) {
  const title = formatTireIndicatorTitle(indicator);
  const glyph = size === "lg" ? 20 : 16;
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        size === "lg" ? "h-7 w-7" : size === "md" ? "h-8 w-8" : "h-6 w-6",
        well && "rounded-md border border-border bg-background",
        indicator.changed ? "text-foreground" : "text-faint",
        className
      )}
    >
      <svg width={glyph} height={glyph} viewBox={`0 0 ${glyph} ${glyph}`} aria-hidden>
        <TireMarkGlyph indicator={indicator} cx={glyph / 2} cy={glyph / 2} size={glyph} />
      </svg>
    </span>
  );
}
