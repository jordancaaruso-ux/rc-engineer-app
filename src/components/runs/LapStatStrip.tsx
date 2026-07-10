import type { ReactNode } from "react";
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
 */
export function StatWellGrid({
  children,
  className,
  gridClassName = "grid-cols-3 sm:grid-cols-4",
}: {
  children: ReactNode;
  className?: string;
  /** grid-template classes for the cells (`grid-cols-3`, …). */
  gridClassName?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-background/45",
        className
      )}
    >
      <div className={cn("grid -ml-px -mt-px", gridClassName)}>{children}</div>
    </div>
  );
}

/**
 * A single strip cell — mono uppercase label + tabular mono value. When
 * `onToggle` is supplied the cell is a button (tap-to-expand lap breakdown) and
 * lights an inset yellow ring while expanded.
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
}) {
  const base = "min-w-0 border-l border-t border-border px-3 py-2 text-left";
  const labelNode = (
    <div
      className={cn(
        "type-data-label",
        alignValue && "line-clamp-2 min-h-[2.6em] leading-[1.3]"
      )}
    >
      {label}
    </div>
  );
  const valueNode = (
    <div
      className={cn(
        "mt-1 font-mono text-[13px] font-medium tabular-nums text-foreground",
        valueClassName
      )}
    >
      {value}
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
          "transition-colors hover:bg-muted/40 active:bg-muted/60",
          expanded && "bg-primary/5 ring-1 ring-inset ring-primary/40"
        )}
      >
        {labelNode}
        {valueNode}
      </button>
    );
  }

  return (
    <div className={base} title={title}>
      {labelNode}
      {valueNode}
    </div>
  );
}
