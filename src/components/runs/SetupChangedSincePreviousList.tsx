"use client";

import { RUN_HISTORY_DATA_CLASS } from "@/components/runs/runHistoryTableColumns";
import type { SetupChangedRow } from "@/lib/setupCompare/changedSincePrevious";
import { cn } from "@/lib/utils";

/**
 * "Setup vs previous run" changed-field list — shared by the Sessions expanded
 * row and the setup sheet modal header. `rows: null` means no baseline exists
 * (no earlier run on this car); an empty array means nothing changed.
 */
export function SetupChangedSincePreviousList({
  rows,
  className,
}: {
  rows: SetupChangedRow[] | null;
  className?: string;
}) {
  if (rows == null) {
    return (
      <p className={cn("text-muted-foreground text-xs", className)}>
        No earlier run on this car to diff against.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className={cn("text-muted-foreground text-xs", className)}>
        No setup changes since your previous run on this car.
      </p>
    );
  }
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/70 divide-y divide-border max-h-48 overflow-y-auto",
        className
      )}
    >
      {rows.map((row) => (
        <div
          key={`${row.label}:${row.value}:${row.previousValue}`}
          className="px-3 py-2 flex flex-col gap-0.5 text-xs sm:flex-row sm:flex-wrap sm:justify-between sm:gap-2"
        >
          <span className="text-muted-foreground shrink-0">{row.label}</span>
          <div className="min-w-0 text-right sm:text-left">
            <span className={cn(RUN_HISTORY_DATA_CLASS, "text-foreground")}>{row.value}</span>
            <span
              className={cn(RUN_HISTORY_DATA_CLASS, "block text-muted-foreground sm:inline sm:ml-2")}
            >
              was {row.previousValue}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
