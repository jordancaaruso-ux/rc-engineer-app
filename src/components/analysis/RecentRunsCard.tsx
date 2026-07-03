"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AnalysisRecentRun } from "@/lib/analysis/analysisHomeModel";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, StatStrip, StatTile } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/utils";

/**
 * Last four runs as an accordion — the most recent starts expanded with its
 * Best / Avg top 5 / Median strip; opening another row collapses the rest.
 */

function seconds(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

function PbChip({ run }: { run: AnalysisRecentRun }) {
  if (!run.isTrackCarPb) return null;
  return (
    <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.1em] text-emerald-300">
      PB
    </span>
  );
}

export function RecentRunsCard({ runs }: { runs: AnalysisRecentRun[] }) {
  const [openId, setOpenId] = useState<string | null>(runs[0]?.id ?? null);

  if (runs.length === 0) {
    return (
      <CardPanel contentClassName="flex flex-col gap-3 p-4">
        <Eyebrow dot="muted">Recent runs</Eyebrow>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          No runs yet. Your last four runs land here with best lap, top-5 average, and median.
        </p>
        <ButtonLink href="/runs/new" className="self-start">
          Log your first run
        </ButtonLink>
      </CardPanel>
    );
  }

  return (
    <CardPanel contentClassName="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow dot="muted">Recent runs</Eyebrow>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
          Last {runs.length}
        </span>
      </div>

      <div className="flex flex-col">
        {runs.map((run, index) => {
          const open = run.id === openId;
          return (
            <div key={run.id} className={cn(index > 0 && "border-t border-border")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : run.id)}
                className="tap-active flex w-full items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13.5px] font-semibold tracking-tight text-foreground">
                    {run.title}
                  </span>
                  <span className="type-timestamp truncate">{run.subLabel}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <PbChip run={run} />
                  <span className="font-mono text-[14px] font-medium tabular-nums text-foreground">
                    {seconds(run.metrics.best)}
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-faint transition-transform",
                      open && "rotate-90 text-muted-foreground"
                    )}
                    aria-hidden
                  />
                </span>
              </button>

              {open ? (
                <div className="flex flex-col gap-2.5 pb-3">
                  <StatStrip className="grid-cols-2 sm:grid-cols-4">
                    <StatTile label="Best" value={seconds(run.metrics.best)} />
                    <StatTile label="Avg top 5" value={seconds(run.metrics.avgTop5)} />
                    <StatTile label="Avg top 10" value={seconds(run.metrics.avgTop10)} />
                    <StatTile label="Median" value={seconds(run.metrics.median)} />
                  </StatStrip>
                  <Link
                    href={`/runs/history?focusRun=${encodeURIComponent(run.id)}`}
                    className="group inline-flex items-center gap-1.5 self-start text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Open run
                    <ChevronRight
                      className="h-3.5 w-3.5 text-primary transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Link
        href="/runs/history"
        className="group inline-flex items-center gap-1.5 self-start pt-0.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
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
