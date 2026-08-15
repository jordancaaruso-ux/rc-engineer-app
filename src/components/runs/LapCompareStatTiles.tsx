"use client";

/**
 * The numbers a lap sheet is opened to find, across the top of the desktop
 * layout: best lap, pace over five and over ten, consistency, and where the best
 * sat in the field.
 *
 * Desktop only, deliberately — the phone reads the same three pace figures off
 * the column headers, which carry them for every ticked session rather than only
 * for the target.
 *
 * Each tile is a stat tile, not a chart: one magnitude, no plot, so no hover
 * layer. The sub-line carries its comparison, tinted only where the direction
 * means something — a lap count is neither good nor bad.
 */

import { cn } from "@/lib/utils";

export type LapStatTile = {
  label: string;
  value: string;
  /** Optional smaller suffix inside the value ("/24", "/11"). */
  valueSuffix?: string | null;
  note?: string | null;
  /** Gain green / loss red / neutral. Counts stay neutral. */
  noteTone?: "good" | "bad" | "muted";
  /** The headline figure of the session — the target's best lap. */
  accent?: boolean;
};

export function LapCompareStatTiles({
  tiles,
  className,
}: {
  tiles: LapStatTile[];
  className?: string;
}) {
  if (tiles.length === 0) return null;
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-md border border-border bg-border",
        className
      )}
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
  );
}
