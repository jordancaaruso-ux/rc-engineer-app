import type { BetweenRunRecentSessionSnapshotV1 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import type { PaceVsFieldMetricSnapshotV1 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { cn } from "@/lib/utils";

function fmtSec(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function fmtDeltaSec(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(3)}s`;
}

function AvgTop10VsFieldHero({ metrics }: { metrics: PaceVsFieldMetricSnapshotV1[] | null | undefined }) {
  const row = metrics?.find((m) => m.metric === "avg_top_10");
  if (!row) {
    return (
      <p className="mt-1.5 text-[10px] text-muted-foreground leading-snug">
        Avg top 10 vs competitors&apos; mean: not available (needs multi-driver imported timing and a matched driver
        row).
      </p>
    );
  }
  const u = row.userSeconds;
  const fMean = row.fieldMeanSeconds;
  if (u == null || fMean == null || !Number.isFinite(u) || !Number.isFinite(fMean)) {
    return (
      <p className="mt-1.5 text-[10px] text-muted-foreground leading-snug">
        Avg top 10 vs competitors&apos; mean: not available.
      </p>
    );
  }
  const gap = row.gapUserMinusFieldMeanSeconds;
  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="font-mono text-[10px] tabular-nums text-foreground/90 leading-snug">
        <span className="font-sans font-medium text-foreground/85">Pace vs field</span>
        {": "}
        Your avg top 10 {fmtSec(u)}s vs competitors&apos; mean avg top 10 {fmtSec(fMean)}s
        {gap != null && Number.isFinite(gap) ? (
          <>
            {" "}
            — Δ {fmtDeltaSec(gap)}{" "}
            <span className="font-sans text-[9px] text-muted-foreground">(positive = slower than mean)</span>
          </>
        ) : null}
        {!row.meaningful ? <span className="text-muted-foreground"> *</span> : null}
      </div>
      {!row.meaningful ? (
        <p className="text-[8px] text-muted-foreground leading-snug">
          * Fair avg top 10 needs at least 10 included laps on your row (same rule as session summaries).
        </p>
      ) : null}
    </div>
  );
}

export function BetweenRunRecentSessionsThings({
  sessions,
  className,
}: {
  sessions: BetweenRunRecentSessionSnapshotV1[];
  className?: string;
}) {
  if (sessions.length === 0) {
    return (
      <p className={cn("text-[11px] text-muted-foreground", className)}>
        No recent session rows on file for this hint.
      </p>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Recent sessions (newest first)
      </div>
      <div className="grid gap-2 sm:grid-cols-1">
        {sessions.map((s, idx) => (
          <div
            key={s.runId}
            className={cn(
              "rounded-lg border border-border bg-card/70 px-3 py-2 text-[11px] leading-snug",
              idx === 0 && "ring-1 ring-primary/25"
            )}
          >
            <div className="font-medium text-foreground/95">{s.displayLabel}</div>
            <div className="mt-1.5 font-mono text-[10px] text-foreground/90 tabular-nums">
              <span className="text-muted-foreground font-sans">Best lap</span> {fmtSec(s.bestLapSeconds)}s
            </div>
            <AvgTop10VsFieldHero metrics={s.paceVsFieldMetrics} />
            {s.setupChangesFromPrevious.length > 0 ? (
              <div className="mt-1.5">
                <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                  Setup changes
                </div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-muted-foreground">
                  {s.setupChangesFromPrevious.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-1.5 text-[10px] text-muted-foreground">No setup changes vs prior on record.</p>
            )}
            {s.notesPreview?.trim() ? (
              <div className="mt-1.5 border-t border-border/60 pt-1.5 text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground/80">Notes:</span> {s.notesPreview.trim()}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
