import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Instrument-panel strip for the Sessions expanded view — the same hairline
 * `/45` glass surface as the dashboard `StatStrip`, reused for lap stats and
 * session-detail fields so the expanded run reads as one designed instrument
 * rather than a scatter of flat grey chips.
 *
 * The strip itself carries the translucent fill; dividers are drawn as top/left
 * cell borders (see `StatWellCell`) with the inner grid offset −1px so the outer
 * cells' borders tuck under the frame — single interior hairlines that stay
 * correct even when the grid wraps.
 *
 * A partial last row would otherwise leave the interior hairlines half-drawn
 * (the empty trailing slot has no cell, so the divider beside the last real cell
 * and the line above the gap never render). We pad the last row with empty
 * bordered filler cells so every row closes into a full rectangle. Because the
 * column count changes at `sm`, the number of fillers differs per breakpoint —
 * we emit both sets and toggle them with `sm:hidden` / `hidden sm:block` so
 * exactly the right count shows at each width.
 */
/**
 * The strip sizes off its own box, not the viewport (`@container`). It has to: in
 * the Sessions workbench this same strip renders in a 614px middle column on a
 * 1600px screen, and a viewport breakpoint would hand it four columns of 150px
 * and wrap every value.
 *
 * Two thresholds, because they answer different questions and the answers are far
 * apart:
 *
 * - **30rem — cells go inline.** A cell needs about 240px to hold a label and its
 *   longest real value on one line ("Additive · Mighty Gripper – Yellow"), and at
 *   the narrow column count 30rem is where cells reach that.
 * - **44rem — one more column.** Only then is there room for another cell without
 *   pushing the others back under 240px.
 *
 * Tying both to one threshold is what a first pass did, and it made the strip
 * *taller* in the middle column: 614px cleared neither, so six cells stacked into
 * three rows. Inline has to arrive first.
 */

const COLS_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};
const WIDE_COLS_CLASS: Record<number, string> = {
  2: "@[44rem]:grid-cols-2",
  3: "@[44rem]:grid-cols-3",
  4: "@[44rem]:grid-cols-4",
};

/** Fillers needed to complete the last row for a given column count. */
function fillerCount(itemCount: number, cols: number): number {
  return (cols - (itemCount % cols)) % cols;
}

export function StatWellGrid({
  children,
  className,
  cols = 3,
  smCols = 4,
}: {
  children: ReactNode;
  className?: string;
  /** Narrow-container column count (`grid-cols-{cols}`). */
  cols?: number;
  /** Column count once the container passes {@link WIDE_AT}. */
  smCols?: number;
}) {
  // toArray drops null / false children, so this is the true visible cell count.
  const itemCount = Children.toArray(children).length;
  const baseFill = fillerCount(itemCount, cols);
  const wideFill = fillerCount(itemCount, smCols);
  return (
    <div
      className={cn(
        "@container overflow-hidden rounded-xl border border-border bg-background/45",
        className
      )}
    >
      <div className={cn("grid -ml-px -mt-px", COLS_CLASS[cols], WIDE_COLS_CLASS[smCols])}>
        {children}
        {Array.from({ length: baseFill }).map((_, i) => (
          <div
            key={`bf-${i}`}
            aria-hidden
            className="border-l border-t border-border @[44rem]:hidden"
          />
        ))}
        {Array.from({ length: wideFill }).map((_, i) => (
          <div
            key={`sf-${i}`}
            aria-hidden
            className="hidden border-l border-t border-border @[44rem]:block"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A single strip cell — Sora micro-label + value. Values are Sora by default
 * (one-voice pass, 2026-07-16); pass `mono` to render lap-derived racing-clock
 * figures (best lap, avg top 5/10, median, stint, consistency) in the surviving
 * JetBrains Mono voice via `.lap-figure`. Everything else — car, tire, additive,
 * dates, counts, conditions, ratings, setup values — stays Sora.
 *
 * When `onToggle` is supplied the cell is a button (tap-to-expand lap breakdown)
 * and lights an inset yellow ring while expanded.
 */
export function StatWellCell({
  label,
  value,
  title,
  expandable,
  expanded,
  onToggle,
  valueClassName,
  alignValue = false,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  title?: string;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  valueClassName?: string;
  /**
   * Reserve a fixed 2-line label box so a wrapping label ("Avg top 5") doesn't
   * shove its value off the baseline shared by its row neighbours. Use on the
   * lap-stat strip; leave off for the session-detail wells (single-line labels
   * there, where the reserve would just add a gap).
   */
  alignValue?: boolean;
  /**
   * Render the value in JetBrains Mono (`.lap-figure`). Reserve for lap-derived
   * performance figures only — the sole surviving mono surface. Defaults to Sora.
   */
  mono?: boolean;
}) {
  const base = "min-w-0 border-l border-t border-border px-3 py-2 text-left @[30rem]:py-[7px]";
  const labelNode = (
    <div
      className={cn(
        "type-data-label @[30rem]:shrink-0",
        // `alignValue`'s reserved 2-line label box only exists to keep stacked
        // values on a shared baseline. Inline they already share one, and the
        // reserve would just re-inflate the row it was protecting.
        alignValue &&
          "line-clamp-2 min-h-[2.6em] leading-[1.3] @[30rem]:min-h-0 @[30rem]:leading-normal"
      )}
    >
      {label}
    </div>
  );
  const valueNode = (
    <div
      className={cn(
        "mt-1 text-[13px] font-medium tabular-nums text-foreground",
        "@[30rem]:mt-0 @[30rem]:min-w-0 @[30rem]:text-right",
        mono && "lap-figure",
        valueClassName
      )}
    >
      {value}
    </div>
  );

  /**
   * Stacked in a narrow strip, label-left/value-right from 30rem. A stacked cell
   * spends two lines saying what one line can as soon as the column can hold the
   * label and the figure side by side. Halves the height of both strips without
   * dropping a single field.
   */
  const body = (
    <div className="@[30rem]:flex @[30rem]:items-baseline @[30rem]:justify-between @[30rem]:gap-2.5">
      {labelNode}
      {valueNode}
    </div>
  );

  if (expandable && onToggle) {
    return (
      <button
        type="button"
        title={title ?? "Tap for lap breakdown"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          base,
          "w-full transition-colors hover:bg-muted/40 active:bg-muted/60",
          expanded && "bg-primary/5 ring-1 ring-inset ring-primary/40"
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={base} title={title}>
      {body}
    </div>
  );
}
