import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLap } from "@/lib/runLaps";
import {
  formatDrivingDuration,
  longestStreak,
  type DashboardPaceTrend,
  type DashboardSummary,
} from "@/lib/dashboardSummary";
import {
  recordMetricLabel,
  type DashboardNewPb,
  type DashboardRecord,
} from "@/lib/dashboardRecords";
import { Eyebrow, StatStrip, StatTile } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { PagedCard } from "@/components/ui/PagedCard";
import { DashboardMetricTile } from "@/components/dashboard/DashboardMetricTile";
import { PaceSparkline } from "@/components/dashboard/PaceSparkline";

/**
 * "How you're going" — the reflective dashboard card, an Apple-widget-style paged card.
 *
 * ── The tracks face, 2026-08-20 (founder call) ───────────────────────────────
 * Face 1 is now **a little session trend per track visited in the last 30 days**, and it is
 * what the card opens on. `summary.paceByTrack` has been computed on every dashboard load
 * and rendered by nothing since the trend face came out; this puts it back on screen.
 *
 * Per-track is the only honest scope. One axis carrying a 12-second club track and an
 * 18-second big track measures the drive to the venue — the same rule that governs the
 * desktop pace chart.
 *
 * **And it reports rather than grades.** The per-track trend was REMOVED on 2026-07-10 for a
 * real reason: a record only moves when you genuinely beat it, whereas a trend drops on one
 * slow session — a green track, traffic, a tyre gamble — and tells a driver they are getting
 * slower when they are not. So this version keeps the shape and the figures and drops the
 * verdict: only a faster window earns green, and a slower one stays in plain ink. Records,
 * which replaced it, are untouched on face 3.
 *
 * `storageKey` moved with it. PagedCard remembers the last face per device, so keeping the
 * old key would have landed every existing driver on Overview and hidden the new face behind
 * a swipe they had no reason to make.
 *
 * Swipe on for the momentum overview and the all-time RECORDS board.
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
      <Eyebrow>How you&rsquo;re going</Eyebrow>

      {/* The window and its totals in one line, so the headline figures need no swipe. The
          Overview face still carries them with their deltas vs the previous 30 days. */}
      {hasData ? (
        <p className="-mt-1 text-[11px] tabular-nums text-muted-foreground">
          Last {summary.windowDays} days · {summary.runs.current}{" "}
          {summary.runs.current === 1 ? "run" : "runs"} · {summary.laps.current} laps ·{" "}
          {formatDrivingDuration(summary.drivingSeconds.current)}
        </p>
      ) : null}

      {/* The earned "little judgement": a real record just fell. */}
      {newPb ? <NewPbBanner newPb={newPb} /> : null}

      {hasData ? (
        <PagedCard
          storageKey="dashboard-how-youre-going"
          // Adaptive so each face hugs its own height — the momentum overview and
          // the records board differ a lot in length and "tallest" left a big gap
          // under the shorter one.
          heightMode="adaptive"
          faces={[
            {
              id: "tracks",
              label: "Pace by track",
              shortLabel: "Tracks",
              content: <TracksFace trends={summary.paceByTrack} windowDays={summary.windowDays} />,
            },
            { id: "overview", label: "Overview", content: <OverviewFace summary={summary} /> },
            { id: "records", label: "Records", content: <RecordsFace records={records} /> },
          ]}
        />
      ) : summary.hasEverLogged ? (
        /* A quiet spell, NOT a new driver. The window is empty but the history is not, so name the
           gap honestly and fall through to the all-time records board, which still has plenty to
           show. Telling someone with years of runs to "log your first run" was the single least
           polished thing in the app — see the note on `hasEverLogged`. */
        <>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            No runs in the last {summary.windowDays} days
            {summary.lastRunLabel ? ` · last out ${summary.lastRunLabel}` : ""}
          </p>
          <RecordsFace records={records} />
        </>
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

/** How many tracks the face draws before the "+N more" line. */
const TRACKS_FACE_MAX_ROWS = 3;

/**
 * Face 1 — one little session trend per track visited in the window.
 *
 * Each row: the track (and class, when the driver runs more than one), the shape of its
 * sessions oldest → newest, how many, and the best lap of the window there.
 *
 * **Only a faster window is coloured.** Green is the app's genuine-pace-win ink and a quicker
 * month has earned it; a slower one prints in plain muted ink rather than red, because one
 * green track or a set of traffic-ruined runs is not a driver getting worse — that judgement is
 * exactly why the old trend face was pulled (see the note at the top of this file).
 */
function TracksFace({ trends, windowDays }: { trends: DashboardPaceTrend[]; windowDays: number }) {
  if (trends.length === 0) {
    return (
      <div className="mt-3">
        <div className="type-data-label">Pace by track</div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Two timed sessions at the same track and its trend lands here — the shape of your
          runs there across the last {windowDays} days, and your best.
        </p>
      </div>
    );
  }

  const rows = trends.slice(0, TRACKS_FACE_MAX_ROWS);
  const moreCount = trends.length - rows.length;

  return (
    <div className="mt-3">
      <div className="type-data-label">Pace by track</div>
      <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background/45">
        {rows.map((trend, i) => (
          <TrackTrendRow
            key={`${trend.trackName}::${trend.className ?? ""}`}
            trend={trend}
            className={i > 0 ? "border-t border-border" : undefined}
          />
        ))}
      </div>
      {moreCount > 0 ? (
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          +{moreCount} more track{moreCount === 1 ? "" : "s"} with a trend
        </p>
      ) : null}
    </div>
  );
}

/** One track's window: name and delta above, the shape and the figures below. */
function TrackTrendRow({ trend, className }: { trend: DashboardPaceTrend; className?: string }) {
  const faster = trend.deltaSeconds < -0.005;
  const level = Math.abs(trend.deltaSeconds) <= 0.005;
  const best = Math.min(...trend.spark);
  return (
    <div className={cn("px-3.5 py-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="type-data-label min-w-0 truncate">
          {trend.trackName}
          {trend.className ? ` · ${trend.className}` : ""}
        </div>
        <div
          className={cn(
            "shrink-0 text-[12.5px] font-semibold tabular-nums",
            faster ? "text-gain" : "text-muted-foreground"
          )}
        >
          {level
            ? "level"
            : `${trend.deltaSeconds > 0 ? "+" : "−"}${Math.abs(trend.deltaSeconds).toFixed(2)}s`}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <PaceSparkline
          values={trend.spark}
          direction={faster ? "faster" : "steady"}
          width={104}
          height={28}
        />
        <div className="shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
          <div className="tabular-nums">
            {trend.runsCount} session{trend.runsCount === 1 ? "" : "s"}
          </div>
          <div className="tabular-nums text-foreground/80">best {formatLap(best)}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Face 2 — momentum + cadence in one: the 30-day totals, the active-days /
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

/** Face 3 — all-time records per track+class: best lap, avg top-5, race pace. */
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
