"use client";

import { cn } from "@/lib/utils";
import {
  motorMountScrewPositions,
  topDeckCutsPositions,
  topDeckScrewPositions,
} from "@/lib/setup/screwNormalize";

export type AwesomatixScrewStripVariant = "motor_mount" | "top_deck" | "top_deck_cuts";

export type AwesomatixScrewStripProps = {
  variant: AwesomatixScrewStripVariant;
  /** Normalized ids: motor "1".."5", top deck "a".."f". */
  selected: string[];
  readOnly?: boolean;
  baselineSelected?: string[] | null;
  hasBaseline?: boolean;
  /** Row-level “changed vs baseline” highlight */
  rowChanged?: boolean;
  onChange?: (next: string[]) => void;
  className?: string;
};

/**
 * PDF-style fixed screw positions (5 motor / 6 top deck) for sheet, parsed review, and compare.
 * Selection state is driven only by structured arrays — no comma-text placeholder in the strip.
 */
export function AwesomatixScrewStrip({
  variant,
  selected,
  readOnly,
  baselineSelected,
  hasBaseline,
  rowChanged,
  onChange,
  className,
}: AwesomatixScrewStripProps) {
  const positions =
    variant === "motor_mount"
      ? motorMountScrewPositions
      : variant === "top_deck_cuts"
        ? topDeckCutsPositions
        : topDeckScrewPositions;
  const ariaLabel =
    variant === "motor_mount"
      ? "Motor mount screws"
      : variant === "top_deck_cuts"
        ? "Top deck cuts"
        : "Top deck screws";
  const setSel = new Set(selected);
  const setBase = new Set(baselineSelected ?? []);

  function toggle(id: string) {
    if (readOnly || !onChange) return;
    const next = new Set(setSel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const order = positions.map((p) => p.id);
    const arr = order.filter((x) => next.has(x));
    onChange(arr);
  }

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1.5",
        rowChanged && "rounded-sm ring-1 ring-amber-500/35",
        className
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <div className="flex w-full items-stretch justify-between gap-1 sm:gap-1.5">
        {positions.map((p) => {
          const on = setSel.has(p.id);
          const was = setBase.has(p.id);
          const cellDiff = Boolean(hasBaseline) && on !== was;
          return (
            <button
              key={p.id}
              type="button"
              disabled={readOnly || !onChange}
              title={
                hasBaseline && baselineSelected
                  ? cellDiff
                    ? was
                      ? `Was selected · now off`
                      : `Was off · now selected`
                    : undefined
                  : undefined
              }
              onClick={() => toggle(p.id)}
              className={cn(
                "flex min-h-[2.25rem] min-w-0 flex-1 items-center justify-center rounded border text-xs font-mono tabular-nums transition",
                "border-border/90 bg-muted/50 text-foreground shadow-sm",
                on && "border-accent/70 bg-accent/20 font-semibold text-accent-foreground ring-1 ring-accent/30",
                !on && "text-muted-foreground",
                cellDiff && "ring-1 ring-amber-500/50",
                (readOnly || !onChange) && "cursor-default opacity-95"
              )}
            >
              <span className="px-0.5">{p.label}</span>
            </button>
          );
        })}
      </div>
      {hasBaseline && baselineSelected != null && baselineSelected.length > 0 ? (
        <div className="text-[9px] font-mono text-muted-foreground/90">
          Compared run:{" "}
          {variant === "motor_mount"
            ? baselineSelected.join(" · ")
            : baselineSelected.map((x) => x.toUpperCase()).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
