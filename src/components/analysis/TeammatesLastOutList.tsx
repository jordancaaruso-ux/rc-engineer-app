"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Collapse } from "@/components/ui/Collapse";
import {
  TEAMMATES_LAST_OUT_VISIBLE,
  type TeammateLastOut,
} from "@/lib/analysis/analysisHomeModel";
import { cn } from "@/lib/utils";

/**
 * The **Last out** band — every teammate, newest run first.
 *
 * ── Why the rows are two lines when the half above them is one ───────────────────────────────
 * Because these lap times are not comparable and the one-line rows above them are. The meeting
 * half puts every driver at one track on one day, so a bare column of figures is a standing. This
 * band spans every track a teammate has ever run, so the same column would be a lie — 24.4 at one
 * circuit against 26.0 at another says nothing about who is quicker. Line two names the track the
 * lap was set at, which is the only thing that makes the number readable, and there is no room
 * for it beside a name and a timestamp at 390px.
 *
 * That also settles what the right-hand column is: **when**, not how far off. No deltas here. Two
 * lists of names each carrying a green-and-red number would read as one badly sorted list; giving
 * each half its own axis is what lets a driver tell in half a second which question they are
 * looking at the answer to.
 *
 * ── The pip ──────────────────────────────────────────────────────────────────────────────────
 * Lit for a run inside `TEAMMATE_LIVE_WINDOW_MS`. It is computed server-side, so it can lag the
 * cache window (30s) — acceptable, because it is atmosphere rather than instrumentation: several
 * pips means the meeting is running and one of your team is on track now, none means everyone is
 * at the bench. It deliberately does NOT animate. A pulsing dot on a page a driver reads between
 * heats is a notification, and this is not one.
 *
 * ── The fold ─────────────────────────────────────────────────────────────────────────────────
 * Five rows, then a door quoting the real total. An expansive list is what was asked for, and a
 * team of fourteen unfolded is three phone screens of card on a page whose first job is the
 * trend chart. `Collapse` animates the height so the rest of the page doesn't jump.
 */
export function TeammatesLastOutList({ rows }: { rows: TeammateLastOut[] }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const visible = rows.slice(0, TEAMMATES_LAST_OUT_VISIBLE);
  const hidden = rows.slice(TEAMMATES_LAST_OUT_VISIBLE);

  return (
    <div className="flex flex-col px-4 pt-1">
      <div className="flex flex-col">
        {visible.map((row, index) => (
          <TeammateRow key={row.userId} row={row} withDivider={index > 0} />
        ))}
      </div>

      {hidden.length > 0 ? (
        <>
          <Collapse open={expanded}>
            <div className="flex flex-col">
              {hidden.map((row) => (
                <TeammateRow key={row.userId} row={row} withDivider />
              ))}
            </div>
          </Collapse>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="tap-active mb-1 mt-1 w-full border-t border-border py-2.5 text-[12px] font-semibold text-primary-ink transition-colors hover:bg-elevate/[0.035]"
          >
            {/* The total, not the remainder: the band's own footer quotes the same number, so the
                figure a driver taps is the figure they were just given. */}
            {expanded ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * "Cooper Webster" → CW, "Glenn" → GL, "NicholasRaceCarDriver" → NI.
 *
 * Two letters always, so every disc weighs the same down the column. A one-word name takes its
 * first two letters rather than one: a single glyph in a 32px circle reads as a bullet, and half
 * this app's rosters are handles rather than first-and-last names.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2);
  return letters.toUpperCase();
}

function TeammateRow({ row, withDivider }: { row: TeammateLastOut; withDivider: boolean }) {
  /*
   * "Ironbark Raceway · 24.918", and each half drops out on its own. A run with no track and no
   * timed lap still gets a line — "Logged a run" — rather than an empty one, because a row whose
   * second line is blank reads as a rendering fault rather than as a thin run.
   */
  const detail = row.lastRunAtIso
    ? [row.trackName, row.bestLapSeconds != null ? row.bestLapSeconds.toFixed(3) : null]
        .filter(Boolean)
        .join(" · ") || "Logged a run"
    : "No shared runs yet";

  return (
    <Link
      href={`/runs/history?teamId=${encodeURIComponent(row.teamId)}&driverIds=${encodeURIComponent(
        row.userId
      )}`}
      prefetch={false}
      aria-label={`${row.name}'s sessions`}
      /*
       * `group/row`, NOT a bare `group`. `SurfaceCard` — which every `CardPanel` is built on —
       * puts a plain `group` on the card itself, so an unnamed `group-hover:` inside it fires when
       * the pointer is anywhere on the CARD: hovering the fold button lit every name in the band
       * at once and slid every chevron. Measured on screen, and it was doing the same thing to the
       * meeting half above before this. A named group scopes the hover back to the row.
       */
      className={cn(
        "tap-active group/row -mx-1.5 flex items-center gap-3 rounded-lg px-1.5 py-2.5 transition-colors hover:bg-elevate/[0.035]",
        withDivider && "border-t border-border"
      )}
    >
      {/*
        Initials, 2026-08-26. Not decoration and not a stand-in for a photo we do not have: this
        band is a wall of left-aligned names of wildly different lengths — "Glenn" over
        "NicholasRaceCarDriver" — and a fixed disc at the head of every row gives the eye a column
        to run down. It is also the only thing on the card that says a row is a PERSON rather than
        a record, which is what a roster is.
      */}
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-secondary text-[10.5px] font-bold tracking-tight text-muted-foreground"
        aria-hidden
      >
        {initialsOf(row.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13.5px] font-medium tracking-tight text-foreground group-hover/row:text-primary-ink">
            {row.name}
          </span>
          {/* Nothing in the right column for a teammate with no shared run. The second line
              already says "No shared runs yet", and printing that twice on one row — once as a
              timestamp, once as a subtitle — reads as a rendering fault. Caught on screen. */}
          {row.lastRunAtIso ? (
            <span className="flex shrink-0 items-center gap-1.5">
              {row.isLive ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-primary/30"
                  aria-hidden
                />
              ) : null}
              <RelativeTime
                iso={row.lastRunAtIso}
                fallback={row.lastRunLabel}
                display="relative"
                className={cn(row.isLive && "font-semibold text-primary-ink")}
              />
            </span>
          ) : null}
        </span>
        <span className="type-timestamp truncate tracking-tight">{detail}</span>
      </span>

      <ChevronRight className="h-4 w-4 shrink-0 text-faint transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-muted-foreground" />
    </Link>
  );
}
