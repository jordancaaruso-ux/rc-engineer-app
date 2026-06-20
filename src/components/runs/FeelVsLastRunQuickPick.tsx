"use client";

import { cn } from "@/lib/utils";
import {
  FEEL_VS_LAST_RUN_QUICK_OPTIONS,
  formatFeelVsLastRunQuickLabel,
  type FeelVsLastRun,
} from "@/lib/runHandlingAssessment";

type Props = {
  value: FeelVsLastRun | null;
  onChange: (next: FeelVsLastRun | null) => void;
  /** Prior run on this car exists — selection required at Run complete. */
  eligible: boolean;
  /** Run complete was blocked — draw attention to this picker. */
  highlightMissing?: boolean;
};

function quickPickButtonClass(
  selected: boolean,
  value: FeelVsLastRun,
  highlightMissing: boolean
): string {
  if (!selected) {
    return cn(
      "rounded-md border px-2 py-1.5 text-[11px] font-medium transition flex-1 min-w-0",
      highlightMissing
        ? "border-amber-500/50 bg-amber-500/5 text-foreground hover:bg-amber-500/10"
        : "border-border bg-surface-runna-inset text-muted-foreground hover:text-foreground",
      value < 0 && "hover:border-destructive/40 hover:bg-destructive/10",
      value === 0 && "hover:bg-muted/80",
      value > 0 && "hover:border-emerald-500/50 hover:bg-emerald-500/5"
    );
  }
  return cn(
    "rounded-md border px-2 py-1.5 text-[11px] font-medium flex-1 min-w-0 shadow-sm",
    value < 0 && "border-destructive/70 bg-destructive/15 text-foreground",
    value === 0 && "border-muted-foreground/60 bg-muted text-foreground",
    value > 0 && "border-emerald-600/70 bg-emerald-500/15 text-foreground"
  );
}

export function FeelVsLastRunQuickPick({
  value,
  onChange,
  eligible,
  highlightMissing = false,
}: Props) {
  const displayValue = eligible ? value : value ?? 0;
  const needsPick = eligible && value == null;
  const selectedLabel =
    displayValue != null ? formatFeelVsLastRunQuickLabel(displayValue) : "Not selected";

  return (
    <div
      className={cn(
        highlightMissing &&
          needsPick &&
          "rounded-md ring-2 ring-amber-500/40 ring-offset-2 ring-offset-background"
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-foreground">
          Compared to last run with this car
        </div>
        <div
          className={cn(
            "text-[11px]",
            highlightMissing && needsPick
              ? "font-medium text-amber-700 dark:text-amber-300"
              : "text-muted-foreground"
          )}
        >
          {highlightMissing && needsPick ? "Pick one below" : selectedLabel}
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label="Compared to last run with this car"
        className="mt-2 flex flex-wrap gap-1"
      >
        {FEEL_VS_LAST_RUN_QUICK_OPTIONS.map(({ value: n, label }) => {
          const selected = displayValue === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              className={quickPickButtonClass(selected, n, highlightMissing && needsPick)}
              onClick={() => onChange(eligible && value === n ? null : n)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
