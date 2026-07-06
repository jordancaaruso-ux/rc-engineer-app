import { cn } from "@/lib/utils";
import { formatLap } from "@/lib/runLaps";
import {
  formatDrivingDuration,
  summaryChangeChip,
  type DashboardPaceTrend,
  type DashboardSummary,
  type SummaryDelta,
} from "@/lib/dashboardSummary";
import { Eyebrow, StatStrip, StatTile } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { DashboardTodayStrip } from "@/components/dashboard/DashboardTodayStrip";

/**
 * Reflective "last 30 days" summary — the dashboard centerpiece (Apple-Health
 * style). Momentum totals with prior-window deltas, an activity-cadence line, and
 * a trustworthy per-track pace trend. Green = faster/more, red = slower/fewer;
 * yellow stays reserved for the one action (the Today strip's log-run button).
 */
export function DashboardSummaryCard({
  summary,
  todayRunCount,
  serverDraftRunId,
  serverDraftSavedAt,
}: {
  summary: DashboardSummary;
  todayRunCount: number;
  serverDraftRunId: string | null;
  serverDraftSavedAt: string | null;
}) {
  const { runs, laps, drivingSeconds, activeDays, tracks, pace, hasData } = summary;

  return (
    <SurfaceCard variant="hero">
      <Eyebrow>Last 30 days</Eyebrow>

      {/* Renders only when today has an unfinished run (owns its own top margin). */}
      <DashboardTodayStrip
        todayRunCount={todayRunCount}
        serverDraftRunId={serverDraftRunId}
        serverDraftSavedAt={serverDraftSavedAt}
      />

      {hasData ? (
        <>
          <StatStrip className="mt-3" gridClassName="grid-cols-3">
            <MetricTile label="Runs" value={String(runs.current)} delta={runs} />
            <MetricTile label="Laps" value={String(laps.current)} delta={laps} />
            <MetricTile
              label="Time driving"
              value={formatDrivingDuration(drivingSeconds.current)}
              delta={drivingSeconds}
              formatDelta={formatDrivingDuration}
            />
          </StatStrip>

          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            <span className="type-data-label">Δ</span> vs the previous 30 days ·{" "}
            <span className="text-foreground">{activeDays}</span> day{activeDays === 1 ? "" : "s"} active
            {" · "}
            <span className="text-foreground">{tracks}</span> track{tracks === 1 ? "" : "s"}
          </p>

          {pace ? <PacePanel pace={pace} /> : null}
        </>
      ) : (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          Log your first run to start building your 30-day summary — runs, laps, wheel
          time, and per-track pace all land here.
        </p>
      )}
    </SurfaceCard>
  );
}

/** A StatTile whose value carries a small colored delta chip beneath it. */
function MetricTile({
  label,
  value,
  delta,
  formatDelta,
}: {
  label: string;
  value: string;
  delta: SummaryDelta;
  /** Render the delta magnitude (e.g. wheel time as a duration); defaults to a plain count. */
  formatDelta?: (n: number) => string;
}) {
  return (
    <StatTile
      label={label}
      className="py-2.5"
      value={
        <span className="flex flex-col gap-0.5">
          <span>{value}</span>
          <DeltaChip delta={delta} formatDelta={formatDelta} />
        </span>
      }
    />
  );
}

/** Signed change vs the prior window. More = green (gain), fewer = red (loss). */
function DeltaChip({
  delta,
  formatDelta = (n) => String(n),
}: {
  delta: SummaryDelta;
  formatDelta?: (n: number) => string;
}) {
  const { diff, direction } = summaryChangeChip(delta);
  if (direction === "flat") {
    return <span className="text-[10px] font-normal text-muted-foreground">±0</span>;
  }
  return (
    <span
      className={cn(
        "text-[10px] font-medium tabular-nums",
        direction === "up" ? "text-[#4FD089]" : "text-destructive"
      )}
    >
      {direction === "up" ? "▲" : "▼"} {formatDelta(Math.abs(diff))}
    </span>
  );
}

function PacePanel({ pace }: { pace: DashboardPaceTrend }) {
  const improved = pace.deltaSeconds < 0;
  const flat = Math.abs(pace.deltaSeconds) < 0.005;
  const deltaCls = flat ? "text-muted-foreground" : improved ? "text-[#4FD089]" : "text-destructive";
  const deltaLabel = flat ? "no change" : improved ? "faster" : "slower";
  const sign = pace.deltaSeconds <= 0 ? "" : "+";

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/45 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="type-data-label truncate">
            Pace · {pace.trackName}
            {pace.className ? ` · ${pace.className}` : ""}
          </div>
          <div className="mt-1 font-mono text-[15px] tabular-nums text-foreground">
            {formatLap(pace.firstBestLap)}
            <span className="mx-1.5 text-muted-foreground">→</span>
            {formatLap(pace.lastBestLap)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("font-mono text-[13px] font-medium tabular-nums", deltaCls)}>
            {sign}
            {pace.deltaSeconds.toFixed(2)}s
          </div>
          <div className="type-data-label mt-0.5">{deltaLabel}</div>
        </div>
      </div>

      <PaceSparkline values={pace.spark} improved={improved} className="mt-2.5" />

      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        Best lap across {pace.runsCount} runs at your most-driven track
      </p>
    </div>
  );
}

/**
 * Single-series best-lap sparkline. Y is inverted so a faster lap sits HIGHER —
 * improvement reads as an upward trend, matching the green delta. The line stays
 * a recessive neutral ink; only the latest-point dot carries gain/loss color.
 */
function PaceSparkline({
  values,
  improved,
  className,
}: {
  values: number[];
  improved: boolean;
  className?: string;
}) {
  const W = 100;
  const H = 26;
  const pad = 3;
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (values.length - 1);
  const y = (v: number) =>
    span === 0 ? H / 2 : pad + ((v - min) / span) * (H - 2 * pad); // faster (min) → top
  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-6 w-full text-muted-foreground/70", className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={2.5}
        className={improved ? "fill-[#4FD089]" : "fill-destructive"}
      />
    </svg>
  );
}
