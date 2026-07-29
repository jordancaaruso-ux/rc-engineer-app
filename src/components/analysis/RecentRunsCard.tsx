import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AnalysisRecentRun } from "@/lib/analysis/analysisHomeModel";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/utils";

/**
 * Last four runs — each row is a door straight into that run's full session
 * view (tap anywhere on the row). No inline accordion: "see everything" lives
 * on the run page. Each row carries the run's best lap with median beneath it;
 * a quiet "See all sessions" footer opens the full history.
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

export function RecentRunsCard({ runs }: { runs: AnalysisRecentRun[] }) {
  if (runs.length === 0) {
    return (
      <CardPanel contentClassName="flex flex-col gap-3 p-4">
        <Eyebrow dot="muted">Recent runs</Eyebrow>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          No runs yet. Your last four runs land here with best lap and median.
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

      <Link
        href="/runs/history"
        className="tap-active group mt-0.5 flex items-center justify-between gap-2 border-t border-border px-1.5 pb-0.5 pt-3 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        See all sessions
        <ChevronRight
          className="h-3.5 w-3.5 text-primary transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </CardPanel>
  );
}
