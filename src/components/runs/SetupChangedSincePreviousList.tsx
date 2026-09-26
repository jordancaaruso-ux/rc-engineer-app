"use client";

import { Fragment, useState } from "react";
import { Maximize2 } from "lucide-react";
import { orderSetupChangedRows, type SetupChangedRow } from "@/lib/setupCompare/changedSincePrevious";
import { SheetBoxCrop, useSheetBoxCrops } from "@/components/runs/SheetBoxCrop";
import { InlineValueEdit } from "@/components/runs/InlineValueEdit";
import { setupKeyIsInlineEditable } from "@/lib/setup/inlineEditableKeys";
import { inSheetWords, sheetBoxHasChoiceWords } from "@/lib/setup/sheetWords";
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
  runId,
  onEditValue,
  maxRows,
  against = "previous",
  ownRun = true,
}: {
  rows: SetupChangedRow[] | null;
  className?: string;
  /**
   * When given, the NOW column becomes tappable and this saves the retyped value.
   *
   * This list is where a driver actually notices a wrong number — it is the one
   * place the app says "you changed this" — so it is the right place to fix it.
   * Omitted on the read-only surfaces (the setup sheet modal, a teammate's run),
   * where the column stays plain text.
   */
  onEditValue?: (key: string, next: string) => Promise<void>;
  /**
   * When given, and this run's chassis came from an uploaded PDF, each row can be opened to show
   * that box on a crop of the sheet — see `SheetBoxCrop`. Every other chassis gets no opener at
   * all, so passing it is always safe and never changes what an ordinary car shows.
   *
   * The RUN, not the car: a car is readable only by its owner, so keying this on the car meant a
   * teammate's run showed no opener at all while the owner's showed one on every row.
   */
  runId?: string | null;
  /**
   * Show this many rows, then "Show all N". The setup pop-up uses it: a 19-row list above the
   * sheet pushed the sheet off the screen (founder call 2026-09-19). Which rows lead is
   * `orderSetupChangedRows`. Without it the list is whole, in its scrolling frame, as before.
   */
  maxRows?: number;
  /**
   * The list is this run against ANOTHER setup — a picked run, a teammate's, a saved sheet — not
   * against the run before it. The columns stop saying Now / Was, and the other value is not
   * struck through: nothing was replaced, they are two cars.
   */
  against?: "previous" | "other";
  /**
   * False on somebody else's run — a teammate's. The empty list then says "their previous run":
   * "your previous run on this car" was untrue on a run and a car that are not yours (test drive
   * 2026-09-26).
   */
  ownRun?: boolean;
}) {
  // Called before the early returns below, because a hook cannot be skipped on some renders.
  // The whole list, not the visible slice, so opening the rest does not fetch again.
  const crops = useSheetBoxCrops(runId, (rows ?? []).map((r) => r.key));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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
        {against === "other"
          ? "No differences."
          : `No setup changes since ${ownRun ? "your" : "their"} previous run on this car.`}
      </p>
    );
  }

  /*
   * In the sheet's own words — "Anti Roll Bar (Front) 1.4", not "anti roll bar front f_1_4" (test
   * drive, 2026-09-26). They arrive with the crops, a moment after the list draws, so the rows are
   * ordered by the names they came with first: the list does not reshuffle when the words land.
   */
  const words = crops.kind === "loading" ? null : crops.words;
  const ordered = inSheetWords(orderSetupChangedRows(rows), words);
  const capped = maxRows != null && ordered.length > maxRows;
  const shown = capped && !showAll ? ordered.slice(0, maxRows) : ordered;

  const cropByKey = crops.kind === "ready" ? crops.byKey : null;
  const spansPages = cropByKey
    ? new Set([...cropByKey.values()].map((c) => c.pageNumber)).size > 1
    : false;

  return (
    <div
      className={cn(
        // Full width, capped. The parameter column below is `1fr`, so the tracks
        // fill the frame and the sticky header band reaches the right edge — the
        // reason this box used to be `w-fit`. The cap stops a one-row diff in a
        // wide pane from stranding the label and its value half a screen apart.
        "w-full max-w-[30rem] overflow-y-auto rounded-md border border-border bg-muted/70",
        // Opened, a capped list gets a taller frame and scrolls INSIDE it, with "Show fewer" pinned
        // to the frame's foot. The first cut let it run to its full length, and against a teammate's
        // car that is fifty to a hundred rows with the only way back at the very bottom (founder,
        // 2026-09-19).
        capped && showAll ? "max-h-[min(24rem,55vh)]" : "max-h-48",
        className
      )}
    >
      {/* Single grid so NOW / WAS align in fixed columns across every row
          (instrument table) — but the value columns are `fit-content`, not
          `auto`: they hug their widest value yet can never take more than 30%
          of the frame each. Before the cap, one long value anywhere in the
          list (even scrolled out of view) starved the parameter column down
          to a couple of characters. The parameter column takes the slack and
          WRAPS rather than truncates — two rows both reading "R…" is worse
          than a taller row.

          Each body row is a `subgrid` wrapper carrying the divider, so the
          line is one continuous stroke. Per-cell borders drew at different
          heights, because `items-baseline` shifts each cell box by its own
          font size — the 12px WAS cell by ~1px, the baseline-less opener cell
          by ~6px (same bug the header's empty cell had, fixed there earlier).

          The fourth column is the opener. It collapses to nothing on a chassis
          with no sheet, which is most of them. */}
      <div className="grid grid-cols-[minmax(0,1fr)_fit-content(30%)_fit-content(30%)_auto]">
        <div className={cn(HEAD_CELL, "pl-3.5 pr-2 text-left")}>Parameter</div>
        <div className={cn(HEAD_CELL, "px-2 text-right")}>{against === "other" ? "This run" : "Now"}</div>
        <div className={cn(HEAD_CELL, "pl-2 pr-3.5 text-right")}>{against === "other" ? "Other" : "Was"}</div>
        <div className={cn(HEAD_CELL, cropByKey ? "pr-2" : "")} />
        {shown.map((row, i) => {
          const crop = cropByKey?.get(row.key);
          const open = openKey === row.key;
          return (
            <Fragment key={`${row.label}:${row.value}:${row.previousValue}`}>
              <div
                className={cn(
                  "col-span-4 grid grid-cols-subgrid items-baseline",
                  i > 0 && "border-t border-border/50"
                )}
              >
                <div className="min-w-0 break-words pl-3.5 pr-2 py-[7px] text-[13px] leading-tight text-muted-foreground">
                  {row.label}
                </div>
                <div className="min-w-0 break-words px-2 py-[7px] text-right text-[13px] tabular-nums leading-tight text-foreground">
                  {/* A row of printed choices is not retyped here: the word shown is not what is
                      stored ("1.3" is kept as `f_1_3`), so it changes with its chips on the sheet. */}
                  {onEditValue && setupKeyIsInlineEditable(row.key) && !sheetBoxHasChoiceWords(words, row.key) ? (
                    <InlineValueEdit
                      label={row.label}
                      value={row.value === "—" ? "" : row.value}
                      numeric
                      onSave={(next) => onEditValue(row.key, next)}
                    />
                  ) : (
                    row.value
                  )}
                </div>
                <div
                  className={cn(
                    "min-w-0 break-words pl-2 pr-3.5 py-[7px] text-right text-[12px] tabular-nums leading-tight",
                    against === "other" ? "text-muted-foreground" : "text-faint line-through"
                  )}
                >
                  {row.previousValue}
                </div>
                <div className={cn("flex items-center self-stretch", crop ? "pr-2" : "")}>
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
              </div>
              {crop && open ? (
                <div className="col-span-4 border-t border-border/50 bg-background/40 px-3.5 py-2">
                  <SheetBoxCrop
                    modelId={crops.kind === "ready" ? crops.modelId : ""}
                    editionBlankId={crops.kind === "ready" ? crops.editionBlankId : null}
                    crop={crop}
                    value={row.value}
                    showPage={spansPages}
                  />
                </div>
              ) : null}
            </Fragment>
          );
        })}
        {capped ? (
          <button
            type="button"
            onClick={(e) => {
              // Shutting it from halfway down would leave the frame scrolled past its three rows.
              if (showAll) e.currentTarget.parentElement?.parentElement?.scrollTo({ top: 0 });
              setShowAll((was) => !was);
            }}
            aria-expanded={showAll}
            className="tap-active sticky bottom-0 z-10 col-span-4 border-t border-border bg-secondary/95 px-3.5 py-[7px] text-left text-[12px] font-medium text-muted-foreground backdrop-blur-sm hover:text-foreground"
          >
            {showAll ? "Show fewer" : `Show all ${ordered.length}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
