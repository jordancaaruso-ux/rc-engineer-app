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
 * The door was stated twice for a while — a small pill beside the eyebrow and a
 * row at the foot. As of 2026-08-18 it is stated ONCE, at the foot, in two parts:
 * a paper row naming what is through it, and a yellow button under that carrying
 * the count. It quotes runs, never "N sessions" — Sessions groups runs by day /
 * meeting, so the two counts are different numbers.
 *
 * The yellow stays on the button and nothing else. A solid yellow band across the
 * whole foot shipped for about an hour the same day and was pulled: it dyed a
 * paragraph of navigation copy in the action colour, and on a phone it sat inches
 * from the dock's yellow log-run circle, making the least important thing on the
 * page the loudest. The house rule survives intact here — yellow is the thing you
 * press, and this time it genuinely is one.
 *
 * If this ever needs to shout louder than a button, the escalation is a Sessions
 * door card of its own on `/analysis` — not more colour in this one.
 */

function seconds(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

function PbChip({ run }: { run: AnalysisRecentRun }) {
  if (!run.isTrackCarPb) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 tabular-nums text-[10px] font-medium tracking-[0.1em] text-emerald-300">
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

  return (
    <CardPanel contentClassName="flex flex-col gap-1 p-4">
      <div className="pb-1.5">
        <Eyebrow dot="muted">Recent runs</Eyebrow>
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
              <span className="text-[18px] font-medium tabular-nums leading-none text-foreground">
                {seconds(run.metrics.best)}
              </span>
              <span className="text-[10px] tabular-nums text-faint">
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
          the foot is clipped to the card's bottom corners for free.

          The ONLY door out of this card — the quiet "All N runs" pill that used to
          sit beside the eyebrow is gone (2026-08-18). It was button-shaped for a
          thing that is not an action, it repeated a count this foot already carries
          with a reason attached, and it was the loudest object in a header row
          where it was the least important one.

          Two parts, and the split is the point (founder call 2026-08-18, after a
          solid-yellow band shipped for an hour and read too loud): the row EXPLAINS
          on paper, the button ACTS in yellow. The band dyed a whole paragraph of
          navigation copy in the app's action colour and landed next to the dock's
          yellow log-run circle, so the loudest thing on the page was the one that
          mattered least. Here yellow covers only the thing you press, which is what
          it has always meant everywhere else.

          The count rides the BUTTON, not the sub-line — "View all 178 runs" is the
          reason to press, and putting it there leaves the paper line free to say
          what the room contains instead of repeating the number.

          `.primary-face-static`, not `.primary-face`: a specular band sweeping
          something this wide reads as a screen wipe rather than shine, so the lit
          rim carries the material and the motion stays with the small buttons. */}
      <Link
        href="/runs/history"
        prefetch
        className="tap-active group -mx-4 -mb-4 mt-1 block border-t border-border px-4 pb-3.5 pt-3 transition-colors hover:bg-primary/[0.05]"
      >
        <span className="flex items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary-ink/35 bg-primary/[0.09] text-primary-ink">
            <History className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-bold leading-tight tracking-tight text-foreground">
              All your sessions
            </span>
            {/* The line runs to two rows at 390px once the icon tile takes its
                width, and left to itself it breaks mid-phrase ("grouped by / day").
                Each clause is nowrap, so the only place it can break is the
                separator — which is where a reader would break it. */}
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              <span className="whitespace-nowrap">Grouped by day ·</span>{" "}
              <span className="whitespace-nowrap">
                {hasTeam ? "filter, compare, team sessions" : "filter and compare"}
              </span>
            </span>
          </span>
        </span>

        {/* A span, not a nested <button> or <a> — the whole foot is already the
            link, and the tap target has to be the whole foot: this bar alone is
            ~40px tall, and on its own that is under the minimum. */}
        <span className="primary-face-static mt-2.5 flex items-center justify-center gap-1.5 rounded-[10px] bg-primary px-3 py-2.5 text-[13px] font-bold tracking-tight text-primary-foreground transition group-hover:brightness-105 group-active:brightness-95">
          View all {runCountLabel(totalRunCount)}
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </Link>
    </CardPanel>
  );
}
