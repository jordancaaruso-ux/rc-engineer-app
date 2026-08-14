import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLap } from "@/lib/runLaps";
import { longestStreak, type DashboardSummary } from "@/lib/dashboardSummary";
import {
  recordMetricLabel,
  type DashboardNewPb,
  type DashboardRecord,
} from "@/lib/dashboardRecords";
import { Eyebrow, StatStrip, StatTile } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { PagedCard } from "@/components/ui/PagedCard";
import { DashboardMetricTile } from "@/components/dashboard/DashboardMetricTile";

/**
 * Reflective dashboard centerpiece — an Apple-widget-style paged card. Swipe
 * between the momentum overview, the all-time RECORDS board, and the activity
 * cadence. Records replaced the old per-track pace trend (2026-07-10): a record
 * only moves when the driver genuinely beats it, so a single slow run can never
 * read as "slower" — the exact flaw the trend had.
 *
 * Colour semantics: green is reserved for a genuine PACE win (a fresh record /
 * the celebration); volume (runs, laps, wheel time) stays neutral ink; yellow
 * stays reserved for the one action (the Start-a-run CTA above this card).
 *
 * The finish-your-draft nudge that used to live here (DashboardTodayStrip) moved
 * up into the dashboard's primary Start-run CTA on 2026-07-16 — it flips to
 * "Finish today's run" when a draft exists, so this card is pure summary again.
 */
export function DashboardSummaryCard({
  summary,
  records,
  newPb,
}: {
  summary: DashboardSummary;
  records: DashboardRecord[];
  newPb: DashboardNewPb | null;
}) {
  const { hasData } = summary;

  return (
    <SurfaceCard variant="hero">
      <Eyebrow>Last 30 days</Eyebrow>

      {/* The earned "little judgement": a real record just fell. */}
      {newPb ? <NewPbBanner newPb={newPb} /> : null}

      {hasData ? (
        <PagedCard
          storageKey="dashboard-summary"
          // Adaptive so each face hugs its own height — the momentum overview and
          // the records board differ a lot in length and "tallest" left a big gap
          // under the shorter one.
          heightMode="adaptive"
          faces={[
            { id: "overview", label: "Overview", content: <OverviewFace summary={summary} /> },
            { id: "records", label: "Records", content: <RecordsFace records={records} /> },
          ]}
        />
      ) : (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          Log your first run to start building your summary — runs, laps, wheel time,
          and your per-track records all land here.
        </p>
      )}
    </SurfaceCard>
  );
}

/** Celebration strip — a record the most recent run just broke. Green = pace win. */
function NewPbBanner({ newPb }: { newPb: DashboardNewPb }) {
  const improvement = Math.max(0, newPb.previousValue - newPb.value);
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-gain/30 bg-gain/10 px-3 py-2.5">
      <Trophy className="size-4 shrink-0 text-gain" aria-hidden />
      <div className="min-w-0 text-[12.5px] leading-snug">
        <span className="font-semibold text-foreground">New {recordMetricLabel(newPb.metric)}</span>
        <span className="text-muted-foreground">
          {" · "}
          {newPb.trackName}
          {newPb.className ? ` · ${newPb.className}` : ""}
        </span>{" "}
        <span className="tabular-nums text-gain">{formatLap(newPb.value)}</span>{""}
        <span className="tabular-nums text-muted-foreground">(−{improvement.toFixed(2)}s)</span>
      </div>
    </div>
  );
}

/**
 * Face 1 — momentum + cadence in one: the 30-day totals, the active-days /
 * tracks / streak trio, and the runs-per-day strip. (Absorbed the old separate
 * Activity face so Overview carries its own height instead of leaving a gap.)
 */
function OverviewFace({ summary }: { summary: DashboardSummary }) {
  const { runs, laps, drivingSeconds, activeDays, tracks, activityByDay } = summary;
  const streak = longestStreak(activityByDay);
  return (
    <div className="mt-3 space-y-3">
      <div>
        <StatStrip gridClassName="grid-cols-3">
          <DashboardMetricTile label="Runs" value={runs.current} delta={runs} />
          <DashboardMetricTile label="Laps" value={laps.current} delta={laps} />
          <DashboardMetricTile
            label="Time driving"
            value={drivingSeconds.current}
            delta={drivingSeconds}
            kind="duration"
          />
        </StatStrip>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          <span className="type-data-label">Δ</span> vs the previous 30 days
        </p>
      </div>

      <StatStrip gridClassName="grid-cols-3">
        <StatTile label="Active days" value={String(activeDays)} className="py-2.5" />
        <StatTile label="Tracks" value={String(tracks)} className="py-2.5" />
        <StatTile label="Best streak" value={`${streak}d`} className="py-2.5" />
      </StatStrip>

      <div className="rounded-xl border border-border bg-background/45 px-3.5 py-3">
        <div className="type-data-label">Runs per day</div>
        <ActivityBars values={activityByDay} className="mt-2" />
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          {runs.current} run{runs.current === 1 ? "" : "s"} across the last {summary.windowDays} days ·
          today at the right
        </p>
      </div>
    </div>
  );
}

/** How many record rows the face shows before the "+N more" line. */
const RECORDS_FACE_MAX_ROWS = 3;

/** Face 2 — all-time records per track+class: best lap, avg top-5, race pace. */
function RecordsFace({ records }: { records: DashboardRecord[] }) {
  if (records.length === 0) {
    return (
      <div className="mt-3">
        <div className="type-data-label">Your records</div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Log timed runs at a track and your records land here — best lap, avg top-5,
          and race pace, per track and class. A record only moves when you beat it.
        </p>
      </div>
    );
  }
  const rows = records.slice(0, RECORDS_FACE_MAX_ROWS);
  const moreCount = records.length - rows.length;
  return (
    <div className="mt-3">
      <div className="type-data-label">Your records</div>
      <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background/45">
        {rows.map((rec, i) => (
          <RecordRow
            key={`${rec.trackName}::${rec.className ?? ""}`}
            record={rec}
            className={i > 0 ? "border-t border-border" : undefined}
          />
        ))}
      </div>
      {moreCount > 0 ? (
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          +{moreCount} more track{moreCount === 1 ? "" : "s"} with records
        </p>
      ) : null}
    </div>
  );
}

/** One track+class record row: label + a fresh-PB flag, then the three bests. */
function RecordRow({ record, className }: { record: DashboardRecord; className?: string }) {
  return (
    <div className={cn("px-3.5 py-2.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="type-data-label min-w-0 truncate">
          {record.trackName}
          {record.className ? ` · ${record.className}` : ""}
        </div>
        {record.freshPbMetric ? (
          <span className="shrink-0 rounded-md bg-gain/15 px-1.5 py-0.5 micro-caps text-gain">
            New PB
          </span>
        ) : (
          <span className="type-data-label shrink-0">
            {record.runsCount} run{record.runsCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <RecordCell label="Best" value={record.bestLap} fresh={record.freshPbMetric === "best"} />
        <RecordCell label="Avg 5" value={record.avgTop5} fresh={record.freshPbMetric === "avgTop5"} />
        <RecordCell label="Race" value={record.racePace} fresh={record.freshPbMetric === "racePace"} />
      </div>
    </div>
  );
}

/** A single record metric cell; the freshly-broken metric renders green. */
function RecordCell({
  label,
  value,
  fresh,
}: {
  label: string;
  value: number | null;
  fresh: boolean;
}) {
  return (
    <div>
      <div className="micro-caps text-faint">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-[13px] tabular-nums",
          fresh ? "text-gain" : "text-foreground"
        )}
      >
        {formatLap(value)}
      </div>
    </div>
  );
}

/**
 * Runs-per-day micro bar strip, oldest → newest. Bars stay recessive neutral
 * ink (activity is volume, not a gain/loss judgment); empty days show as faint
 * baseline stubs so the time axis stays readable.
 */
function ActivityBars({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={cn("flex h-8 items-end gap-[2px]", className)} aria-hidden>
      {values.map((count, i) => (
        <span
          key={i}
          className={cn(
            "min-h-[2px] flex-1 rounded-[1px]",
            count > 0 ? "bg-foreground/60" : "bg-foreground/15"
          )}
          style={{ height: count > 0 ? `${Math.max(18, (count / max) * 100)}%` : undefined }}
        />
      ))}
    </div>
  );
}
