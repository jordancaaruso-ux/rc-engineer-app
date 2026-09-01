"use client";

/**
 * The numbers a lap sheet is opened to find, across the top of the desktop
 * layout: best lap, pace over five and over ten, consistency, and where the best
 * sat in the field.
 *
 * Two layouts. `tiles` is the desktop strip. `band` is the phone's (founder call,
 * 2026-08-29): the same five figures on one row under the target's name, with no
 * comparison notes — the column headers carry those per driver, and a 69px cell has
 * no room for "+0.039 on Simon Lauter". The band existed because the phone had
 * NOTHING of this: no "vs field", and no way to change whose sheet it was without
 * opening the picker sheet. On the band the name IS the control — the target
 * dropdown is drawn as the heading — so switching to P2 is one tap on the name.
 *
 * Each tile is a stat tile, not a chart: one magnitude, no plot, so no hover
 * layer. The sub-line carries its comparison, tinted only where the direction
 * means something — a lap count is neither good nor bad.
 *
 * The strip is HEADED by whose numbers they are. It shipped bare, and on a race the
 * reader was not in it read as their own run when it was the winner's (founder,
 * 2026-08-27: "reads as though it's my run"). The heading names the target, and the
 * control beside it is how you change who that is — the same choice the picker offers,
 * put where the question gets asked.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type LapStatTile = {
  label: string;
  /** The band's word for it — the column headers' own vocabulary ("Avg5", "Cons"). */
  shortLabel?: string | null;
  value: string;
  /** Optional smaller suffix inside the value ("/24", "/11"). */
  valueSuffix?: string | null;
  /** Band-only replacement suffix where the full one won't fit a ~60px cell ("/5:12.3"). */
  bandValueSuffix?: string | null;
  /**
   * Left off the phone band. The band's five-across row is settled (2026-08-29);
   * when a sixth figure earns a desktop tile, something must yield here instead.
   */
  hideOnBand?: boolean;
  note?: string | null;
  /** Gain green / loss red / neutral. Counts stay neutral. */
  noteTone?: "good" | "bad" | "muted";
  /** The headline figure of the session — the target's best lap. */
  accent?: boolean;
};

export type LapStatHeading = {
  /** Who the figures belong to — a driver on a race sheet, a session on your own runs. */
  name: string;
  /** "target · 9 Aug, 1:20 PM · Finals D" */
  context: string | null;
  /** The way to change the target, when there is a choice. */
  control?: ReactNode;
};

export function LapCompareStatTiles({
  tiles,
  heading,
  layout = "tiles",
  className,
}: {
  tiles: LapStatTile[];
  heading?: LapStatHeading | null;
  layout?: "tiles" | "band";
  className?: string;
}) {
  if (tiles.length === 0) return null;

  if (layout === "band") {
    const bandTiles = tiles.filter((t) => !t.hideOnBand);
    return (
      <div className={cn("overflow-hidden rounded-md border border-border", className)}>
        {heading ? (
          <div className="border-b border-border bg-surface-runna px-3 py-2 leading-tight">
            {/* The control carries the name when there is a choice; otherwise the name stands. */}
            {heading.control ?? (
              <div className="truncate text-[13px] font-semibold text-foreground">{heading.name}</div>
            )}
            {heading.context ? (
              <div className="truncate text-[10px] text-muted-foreground">{heading.context}</div>
            ) : null}
          </div>
        ) : null}
        <div
          className="grid gap-px bg-border"
          style={{ gridTemplateColumns: `repeat(${bandTiles.length}, minmax(0, 1fr))` }}
        >
          {bandTiles.map((t) => {
            const suffix = t.bandValueSuffix ?? t.valueSuffix;
            return (
              <div key={t.label} className="flex min-w-0 flex-col gap-0.5 bg-surface-runna px-2 py-1.5">
                <span className="ui-label-caps truncate text-[9px] uppercase tracking-wider">
                  {t.shortLabel ?? t.label}
                </span>
                <span
                  className={cn(
                    "fig-stat truncate leading-tight",
                    t.accent ? "text-primary-ink" : "text-foreground"
                  )}
                >
                  {t.value}
                  {suffix ? (
                    <span className="text-[10px] text-muted-foreground">{suffix}</span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-md border border-border", className)}>
      {heading ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border bg-surface-runna px-3 py-2">
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold text-foreground">{heading.name}</div>
            {heading.context ? (
              <div className="truncate text-[10px] text-muted-foreground">{heading.context}</div>
            ) : null}
          </div>
          {heading.control ? <div className="shrink-0">{heading.control}</div> : null}
        </div>
      ) : null}
      <div
        className="grid gap-px bg-border"
        /*
         * Columns follow the tiles, rather than a hardcoded 5. "Vs field" only
         * exists on a session with a timing import, so on every other run the
         * fixed grid left a fifth cell with nothing in it — and since the wrapper
         * is painted in the border colour to draw the hairlines, that empty cell
         * rendered as a solid block of border.
         */
        style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}
      >
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-1 bg-surface-runna px-3 py-2.5">
            <span className="ui-label-caps text-[9px] uppercase tracking-wider">{t.label}</span>
            <span
              className={cn(
                "text-[18px] leading-none tabular-nums",
                t.accent ? "text-primary-ink" : "text-foreground"
              )}
            >
              {t.value}
              {t.valueSuffix ? (
                <span className="text-[12px] text-muted-foreground">{t.valueSuffix}</span>
              ) : null}
            </span>
            <span
              className={cn(
                "text-[10px] tabular-nums",
                t.note == null && "opacity-0",
                t.noteTone === "good" && "text-gain",
                t.noteTone === "bad" && "text-destructive",
                (t.noteTone === "muted" || t.noteTone == null) && "text-muted-foreground"
              )}
              aria-hidden={t.note == null ? true : undefined}
            >
              {/* The slot holds its line height even when empty so all five tiles
                  keep one baseline — a missing field rank must not shorten a tile. */}
              {t.note ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
