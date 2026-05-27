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
};

function quickPickButtonClass(selected: boolean, value: FeelVsLastRun): string {
  if (!selected) {
    return cn(
      "rounded-md border px-2 py-1.5 text-[11px] font-medium transition flex-1 min-w-0",
      "border-border bg-card text-muted-foreground hover:text-foreground",
      value < 0 && "hover:border-red-400/50 hover:bg-red-500/5",
      value === 0 && "hover:bg-muted/80",
      value > 0 && "hover:border-emerald-500/50 hover:bg-emerald-500/5"
    );
  }
  return cn(
    "rounded-md border px-2 py-1.5 text-[11px] font-medium flex-1 min-w-0 shadow-sm",
    value < 0 && "border-red-500/70 bg-red-500/15 text-foreground",
    value === 0 && "border-muted-foreground/60 bg-muted text-foreground",
    value > 0 && "border-emerald-600/70 bg-emerald-500/15 text-foreground"
  );
}

export function FeelVsLastRunQuickPick({ value, onChange, eligible }: Props) {
  const displayValue = eligible ? value : value ?? 0;
  const selectedLabel =
    displayValue != null ? formatFeelVsLastRunQuickLabel(displayValue) : "Not selected";

  return (
    <div className="rounded-md border border-border/80 bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-foreground">
          vs last run on this car{" "}
          <span className="text-[10px] font-normal text-muted-foreground">
            (required to complete)
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">{selectedLabel}</div>
      </div>
      <div
        role="radiogroup"
        aria-label="Feel vs last run on this car"
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
              className={quickPickButtonClass(selected, n)}
              onClick={() => onChange(eligible && value === n ? null : n)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
        {eligible
          ? "Required to complete the run. The Engineer uses this with your car rating to track setup direction."
          : "First run on this car — defaults to Similar. Change if you had a prior baseline in mind."}
      </p>
    </div>
  );
}
