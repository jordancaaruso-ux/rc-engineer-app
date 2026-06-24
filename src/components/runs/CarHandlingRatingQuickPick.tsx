"use client";

import { cn } from "@/lib/utils";

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
  return (
    <div
      className={cn(
        highlightMissing &&
          !readOnly &&
          "rounded-md ring-2 ring-amber-500/40 ring-offset-2 ring-offset-background"
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-foreground">Car handling rating</div>
        <div
          className={cn(
            "text-[11px]",
            highlightMissing && value == null && !readOnly
              ? "font-medium text-amber-700 dark:text-amber-300"
              : "text-muted-foreground"
          )}
        >
          {value == null
            ? highlightMissing && !readOnly
              ? "Pick a rating"
              : "Not rated"
            : `${value} / 10`}
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label="Car handling rating 1 to 10"
        aria-readonly={readOnly || undefined}
        className={cn("mt-2 grid grid-cols-10 gap-1", readOnly && "pointer-events-none")}
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={readOnly}
              tabIndex={readOnly ? -1 : undefined}
              onClick={readOnly ? undefined : () => onChange?.(n)}
              className={cn(
                "rounded-md border px-0 py-1.5 text-[11px] font-medium tabular-nums",
                !readOnly && "transition",
                selected
                  ? "border-accent bg-accent text-accent-foreground shadow-sm"
                  : readOnly
                    ? "border-border bg-surface-runna-inset text-foreground"
                    : highlightMissing
                      ? "border-amber-500/50 bg-amber-500/5 text-foreground hover:bg-amber-500/10"
                      : "border-border bg-surface-runna-inset text-foreground hover:bg-surface-runna"
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
