"use client";

import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";

/**
 * Who is on the sheet, as a row of chips above the grid.
 *
 * A race opens on its whole field (founder call, 2026-08-27), and the same day: "there
 * should be chips to select who you want a comparison of, because most likely you don't
 * want a comparison of everyone." The picker still adds sessions from elsewhere — your own
 * runs, another heat — but for the everyday case of "just me and the two I was racing",
 * the chips are the whole control. Each one is a column; the same set drives the charts.
 *
 * The target is pinned first and cannot be switched off — it is what everything else is
 * measured against, and a sheet with no baseline has nothing to say. Changing WHO the
 * target is lives with the target picker and the stat card, not here.
 */
export type LapDriverChip = {
  id: string;
  label: string;
  on: boolean;
  isTarget: boolean;
  /** False while that driver's laps are still being fetched — not selectable yet. */
  loaded: boolean;
};

export function LapCompareDriverChips({
  chips,
  onToggle,
  onAll,
  onNone,
  focusedId,
  onFocus,
  className,
}: {
  chips: LapDriverChip[];
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
  /** The chip whose line is lifted on the chart, and vice versa. */
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  className?: string;
}) {
  if (chips.length < 2) return null;
  const onCount = chips.filter((c) => c.on && !c.isTarget).length;
  const selectable = chips.filter((c) => !c.isTarget && c.loaded).length;
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="group"
      aria-label="Who is on the sheet"
      onMouseLeave={() => onFocus(null)}
    >
      {chips.map((c) => {
        const focused = c.id === focusedId;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.on}
            aria-disabled={c.isTarget || !c.loaded ? true : undefined}
            disabled={!c.loaded}
            title={c.isTarget ? "The target stays on the sheet" : c.on ? "Remove from the sheet" : "Add to the sheet"}
            className={cn(
              chipToggleClass(c.on),
              "tap-active max-w-[11rem] truncate px-2 py-1 text-[11px] leading-tight",
              c.isTarget && "cursor-default",
              focused && "ring-1 ring-foreground/40"
            )}
            onClick={() => {
              if (c.isTarget) return;
              onToggle(c.id);
            }}
            onMouseEnter={() => onFocus(c.id)}
            onFocus={() => onFocus(c.id)}
            onBlur={() => onFocus(null)}
          >
            {c.isTarget ? <span className="mr-1 text-[9px] uppercase tracking-wider text-primary-ink">target</span> : null}
            {c.label}
            {!c.loaded ? <span className="ml-1 text-muted-foreground">…</span> : null}
          </button>
        );
      })}
      {/* Ten chips is a lot to tap one by one, in either direction. */}
      <span className="ml-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        <button
          type="button"
          className="underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50 disabled:hover:no-underline"
          onClick={onAll}
          disabled={onCount >= selectable}
        >
          All
        </button>
        <button
          type="button"
          className="underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50 disabled:hover:no-underline"
          onClick={onNone}
          disabled={onCount === 0}
        >
          None
        </button>
      </span>
    </div>
  );
}
