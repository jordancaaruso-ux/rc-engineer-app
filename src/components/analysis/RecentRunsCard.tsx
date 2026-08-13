import Link from "next/link";
import { ChevronRight, History } from "lucide-react";
import type { AnalysisRecentRun } from "@/lib/analysis/analysisHomeModel";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/utils";

/**
 * The most recent runs — each row is a door straight into that run's full
 * session view (tap anywhere on the row). No inline accordion: "see everything"
 * lives on the run page. Each row carries the run's best lap with median
 * beneath it.
 *
 * ── The Sessions door, 2026-08-09 ────────────────────────────────────────────
 * This card carries the ONLY way into Sessions from `/analysis` on a phone: the
 * hub's door tiles are filtered down to Setup comparison and Geometry Lab
 * (`src/app/analysis/page.tsx`), so the Sessions entry in `ANALYSIS_HUB_LINKS`
 * never renders, and the mobile dock's Analysis tab is `/analysis` — only the
 * desktop sidebar points straight at `/runs/history`. It used to be one 12.5px
 * muted line reading "See all sessions", which is fine print advertising a list
 * control; behind it is every run the driver has ever logged.
 *
 * So the door is now stated twice, at both ends of the card:
 *   · a quiet "All N runs" affordance beside the eyebrow, so you learn this card
 *     is a PREVIEW before you read the rows rather than after;
 *   · a full row at the foot, weighted like the run rows above it.
 * Both quote runs, never "N sessions" — Sessions groups runs by day / meeting,
 * so the two counts are different numbers.
 *
 * If this ever needs to shout louder, the escalation is to render the Sessions
 * tile as its own door card on `/analysis` — not to make this card noisier.
 */

function seconds(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

function PbChip({ run }: { run: AnalysisRecentRun }) {
  if (!run.isTrackCarPb) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.1em] text-emerald-300">
      PB
    </span>
  );
}

function runCountLabel(count: number): string {
  return `${count} run${count === 1 ? "" : "s"}`;
}

export function RecentRunsCard({
  runs,
  totalRunCount,
  hasTeam = false,
}: {
  runs: AnalysisRecentRun[];
  totalRunCount: number;
  /** Team member → the door names team sessions, because it can actually open them. */
  hasTeam?: boolean;
}) {
  if (runs.length === 0) {
    return (
      <CardPanel contentClassName="flex flex-col gap-3 p-4">
        <Eyebrow dot="muted">Recent runs</Eyebrow>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          No runs yet. Your latest runs land here with best lap and median.
        </p>
        <ButtonLink href="/runs/new" className="self-start">
          Log your first run
        </ButtonLink>
      </CardPanel>
    );
  }

  // Suppressed when the card already shows everything — "All 3 runs" beside
  // exactly three rows promises a bigger room than it opens. The footer door
  // stays either way: grouped days, filters and compare are still through it.
  const showHeaderAffordance = totalRunCount > runs.length;

  return (
    <CardPanel contentClassName="flex flex-col gap-1 p-4">
      <div className="pb-1.5">
        {/* `eyebrow-root` (hairline + pad) composed by hand rather than via
            <Eyebrow> so the count can sit on the label's row — same trick the
            hub door cards use. */}
        <div className="eyebrow-root mb-2 flex items-center gap-3">
          <span className="eyebrow-label min-w-0 flex-1">Recent runs</span>
          {showHeaderAffordance ? (
            <Link
              href="/runs/history"
              prefetch
              /*
               * The vertical padding is deliberately uneven, and `leading-none` is load-
               * bearing. `text-[11px]` sets font-size only, so the text kept the inherited
               * 1.5 line-height: an 11px glyph in a 16.5px line box, with all of the slack
               * below the baseline as unused descender space. Since "All 191 runs" has no
               * descenders, the ink (cap-top to baseline) sat ~1px ABOVE the pill's centre
               * and the pill read bottom-heavy — the "not vertically centred" report.
               *
               * leading-none collapses the line box to the font size; 5px over 3px puts the
               * ink on the centre line and keeps the pill its original 22px tall, so the tap
               * target does not shrink.
               */
              className="tap-active group flex shrink-0 items-center gap-1 rounded-full border border-primary-ink/35 pb-[3px] pl-2.5 pr-1.5 pt-[5px] text-[11px] font-semibold leading-none tabular-nums text-primary-ink transition-colors hover:border-primary-ink/60 hover:bg-primary/10"
            >
              All {runCountLabel(totalRunCount)}
              {/* Same cause: the chevron centres on the line box, the text centres on its
                  ink, leaving the arrow a pixel low. -0.5 margin lifts it onto the text. */}
              <ChevronRight
                className="-mt-0.5 h-3 w-3 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col">
        {runs.map((run, index) => (
          <Link
            key={run.id}
            href={`/runs/${encodeURIComponent(run.id)}`}
            className={cn(
              "tap-active group -mx-1.5 flex items-center gap-3 rounded-lg px-1.5 py-3 transition-colors hover:bg-white/[0.035]",
              index > 0 && "rounded-none border-t border-border"
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13.5px] font-semibold tracking-tight text-foreground">
                  {run.title}
                </span>
                <PbChip run={run} />
              </span>
              <span className="type-timestamp truncate">{run.subLabel}</span>
            </span>

            <span className="flex flex-col items-end gap-px">
              <span className="font-mono text-[17px] font-medium tabular-nums leading-none text-foreground">
                {seconds(run.metrics.best)}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-faint">
                med{" "}
                <span className="font-medium text-muted-foreground">
                  {seconds(run.metrics.median)}
                </span>
              </span>
            </span>

            <ChevronRight
              className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
              aria-hidden
            />
          </Link>
        ))}
      </div>

      {/* Full-bleed to the card edges: the negative margins reach past the p-4,
          and SurfaceCard's content wrapper is `rounded-xl overflow-hidden`, so
          the tinted band is clipped to the card's bottom corners for free. */}
      <Link
        href="/runs/history"
        prefetch
        className="tap-active group -mx-4 -mb-4 mt-1 flex items-center gap-3 border-t border-border bg-primary/[0.04] px-4 py-3 transition-colors hover:bg-primary/[0.08]"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary-ink/35 bg-primary/[0.09] text-primary-ink">
          <History className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold leading-tight tracking-tight text-foreground">
            All sessions
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            {runCountLabel(totalRunCount)}, grouped by day ·{" "}
            {hasTeam ? "filter, compare, team sessions" : "filter and compare"}
          </span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-primary-ink transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </CardPanel>
  );
}
