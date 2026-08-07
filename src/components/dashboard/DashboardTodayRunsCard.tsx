import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import { CardPanel } from "@/components/ui/CardPanel";

const GAIN = "text-[#4FD089]";
const LOSS = "text-destructive";

/** Signed lap delta, 3 decimals — negative (faster) reads green, positive red. */
function DeltaChip({ delta }: { delta: number }) {
  const faster = delta < 0;
  return (
    <span className={cn("text-[11px] font-semibold tabular-nums", faster ? GAIN : LOSS)}>
      {faster ? "▼" : "▲"} {Math.abs(delta).toFixed(3)}
    </span>
  );
}

/** One-line summary of a run's setup changes: "Front sway 1.4 → 1.5 · +2 more". */
function changedLine(
  rows: DashboardHomeModel["todayStrip"][number]["changedRows"]
): string | null {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 2).map((row) => {
    const unit = row.unit ? ` ${row.unit}` : "";
    return row.previous != null
      ? `${row.label} ${row.previous} → ${row.current}${unit}`
      : `${row.label} ${row.current}${unit}`;
  });
  const extra = rows.length - shown.length;
  return extra > 0 ? `${shown.join(" · ")} · +${extra} more` : shown.join(" · ");
}

/**
 * Track-day pit board — the day's story, latest run first: pace, delta vs the
 * previous run, and what setup changed going into it.
 *
 * Desktop only (`hidden xl:block`). This is the v2-retired "Today so far" strip,
 * un-retired at xl+ on 2026-08-07 — see docs/DASHBOARD_NORTH_STAR.md. It was
 * removed because at 390px a run list duplicated the top of Analysis and cost the
 * verdict card its place; in a 1184px pane it costs nothing, and `todayStrip` never
 * stopped being built. The phone dashboard is unchanged, which is why this renders
 * nothing below xl rather than being conditionally mounted.
 *
 * Still one line per run and no charts — the boundary rule holds at every width.
 * Rows tap through to the run; depth stays in Sessions.
 */
export function DashboardTodayRunsCard({
  strip,
}: {
  strip: DashboardHomeModel["todayStrip"];
}) {
  if (strip.length === 0) return null;

  return (
    <CardPanel className="hidden xl:block">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Eyebrow className="mb-0">Today so far</Eyebrow>
        <span className="text-[12px] text-muted-foreground">
          {strip.length} {strip.length === 1 ? "run" : "runs"}
        </span>
      </div>

      <ul className="mt-2.5">
        {strip.map((run, i) => {
          const changes = changedLine(run.changedRows);
          return (
            <li key={run.runId} className={cn(i > 0 && "border-t border-border/70")}>
              <Link
                href={`/runs/${run.runId}`}
                prefetch={false}
                className="tap-active flex items-start justify-between gap-3 rounded-lg py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold tracking-tight text-foreground">
                      {run.runLabel}
                    </span>
                    <span className="lap-figure text-[11px] text-faint">{run.timeLabel}</span>
                    {!run.loggingComplete ? (
                      <span className="rounded-md border border-border px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                        Draft
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[11.5px] leading-snug text-muted-foreground">
                    {changes ?? "No setup change"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="flex items-baseline justify-end gap-2">
                    {run.bestDeltaVsPrev != null ? <DeltaChip delta={run.bestDeltaVsPrev} /> : null}
                    <span className="lap-figure text-[15px] font-medium text-foreground">
                      {formatLap(run.bestLap)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {run.avgTop5 != null ? (
                      <>
                        avg 5 <span className="lap-figure">{formatLap(run.avgTop5)}</span>
                      </>
                    ) : run.lapCount > 0 ? (
                      `${run.lapCount} laps`
                    ) : (
                      "no laps yet"
                    )}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </CardPanel>
  );
}
