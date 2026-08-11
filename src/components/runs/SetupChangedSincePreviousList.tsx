"use client";

import { Fragment, useState } from "react";
import { Maximize2 } from "lucide-react";
import type { SetupChangedRow } from "@/lib/setupCompare/changedSincePrevious";
import { SheetBoxCrop, useSheetBoxCrops } from "@/components/runs/SheetBoxCrop";
import { cn } from "@/lib/utils";

const HEAD_CELL =
  "sticky top-0 z-10 border-b border-border bg-secondary/95 py-2 font-sans text-[10px] font-semibold uppercase tracking-[0.06em] text-faint backdrop-blur-sm";

/**
 * "Setup vs previous run" changed-field list — shared by the Sessions expanded
 * row and the setup sheet modal header. `rows: null` means no baseline exists
 * (no earlier run on this car); an empty array means nothing changed.
 */
export function SetupChangedSincePreviousList({
  rows,
  className,
  carId,
}: {
  rows: SetupChangedRow[] | null;
  className?: string;
  /**
   * When given, and this car's chassis came from an uploaded PDF, each row can be opened to show
   * that box on a crop of the driver's own sheet — see `SheetBoxCrop`. Every other chassis gets no
   * opener at all, so passing it is always safe and never changes what an ordinary car shows.
   */
  carId?: string | null;
}) {
  // Called before the early returns below, because a hook cannot be skipped on some renders.
  const crops = useSheetBoxCrops(carId, (rows ?? []).map((r) => r.key));
  const [openKey, setOpenKey] = useState<string | null>(null);

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

  const cropByKey = crops.kind === "ready" ? crops.byKey : null;
  const spansPages = cropByKey
    ? new Set([...cropByKey.values()].map((c) => c.pageNumber)).size > 1
    : false;

  return (
    <div
      className={cn(
        // `w-fit` so the frame hugs the tracks. Without it the box stays full
        // width while the packed tracks don't, and the sticky header band stops
        // half way across.
        "max-h-48 w-fit max-w-full overflow-y-auto rounded-md border border-border bg-muted/70",
        className
      )}
    >
      {/* Single grid so NOW / WAS align in fixed columns across every row —
          the widest value in each column sets its width (instrument table).

          The parameter column is `max-content`, not `1fr`, and the tracks pack
          left. As `1fr` it ate every spare pixel, so in a wide pane a one-row
          diff put "Toe (Rear)" against the left wall and "3.5" against the right
          with 500px of nothing between them — the change and its value stopped
          reading as one fact. `minmax(0, …)` keeps it able to shrink and truncate
          when the column is genuinely narrow.

          The fourth column is the opener. It collapses to nothing on a chassis
          with no sheet, which is most of them. */}
      <div className="grid grid-cols-[minmax(0,max-content)_auto_auto_auto] items-baseline justify-start">
        <div className={cn(HEAD_CELL, "pl-3.5 pr-2 text-left")}>Parameter</div>
        <div className={cn(HEAD_CELL, "px-2 text-right")}>Now</div>
        <div className={cn(HEAD_CELL, "pl-2 pr-3.5 text-right")}>Was</div>
        <div className={cn(HEAD_CELL, cropByKey ? "pr-2" : "")} />
        {rows.map((row, i) => {
          const divider = i > 0 ? "border-t border-border/50" : undefined;
          const crop = cropByKey?.get(row.key);
          const open = openKey === row.key;
          return (
            <Fragment key={`${row.label}:${row.value}:${row.previousValue}`}>
              <div className={cn("min-w-0 truncate pl-3.5 pr-2 py-[7px] text-[13px] leading-tight text-muted-foreground", divider)}>
                {row.label}
              </div>
              <div className={cn("px-2 py-[7px] text-right text-[13px] tabular-nums leading-tight text-foreground", divider)}>
                {row.value}
              </div>
              <div className={cn("pl-2 pr-3.5 py-[7px] text-right text-[12px] tabular-nums leading-tight text-faint line-through", divider)}>
                {row.previousValue}
              </div>
              <div className={cn("py-[3px]", divider, crop ? "pr-2" : "")}>
                {crop ? (
                  <button
                    type="button"
                    onClick={() => setOpenKey(open ? null : row.key)}
                    aria-expanded={open}
                    aria-label={
                      open
                        ? `Hide ${row.label} on the setup sheet`
                        : `Show ${row.label} on the setup sheet`
                    }
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-border/60 hover:text-foreground",
                      open && "bg-border/60 text-foreground"
                    )}
                  >
                    <Maximize2 className="h-3 w-3" aria-hidden />
                  </button>
                ) : null}
              </div>
              {crop && open ? (
                <div className="col-span-4 border-t border-border/50 bg-background/40 px-3.5 py-2">
                  <SheetBoxCrop
                    modelId={crops.kind === "ready" ? crops.modelId : ""}
                    crop={crop}
                    value={row.value}
                    showPage={spansPages}
                  />
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
