import type { BetweenRunRecentSessionSnapshotV1 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";

function fmtSec(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function competitorsAvgTop10Line(metrics: BetweenRunRecentSessionSnapshotV1["paceVsFieldMetrics"]) {
  const row = metrics?.find((m) => m.metric === "avg_top_10");
  const fMean = row?.fieldMeanSeconds;
  const hasValue = fMean != null && Number.isFinite(fMean);
  return (
    <div>
      <span className="text-muted-foreground font-sans">Competitors avg top 10</span>{" "}
      {hasValue ? <>{fmtSec(fMean)}s</> : <span className="text-muted-foreground">—</span>}
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
      <Eyebrow>Recent sessions (newest first)</Eyebrow>
      <div className="grid gap-2 sm:grid-cols-1">
        {sessions.map((s, idx) => {
          return (
            <div
              key={s.runId}
              className={cn(
                "rounded-lg border border-border bg-card/70 px-3 py-2 text-[11px] leading-snug",
                idx === 0 && "ring-1 ring-primary/25"
              )}
            >
              <div className="font-medium text-foreground/95">{s.displayLabel}</div>
              <div className="mt-1.5 space-y-0.5 font-mono text-[10px] text-foreground/90 tabular-nums">
                <div>
                  <span className="text-muted-foreground font-sans">Best lap</span> {fmtSec(s.bestLapSeconds)}s
                </div>
                <div>
                  <span className="text-muted-foreground font-sans">Avg top 5</span>{" "}
                  {s.avgTop5NotMeaningful ? (
                    <span className="text-muted-foreground">— *</span>
                  ) : (
                    <>{fmtSec(s.avgTop5LapSeconds ?? null)}s</>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground font-sans">Avg top 10</span>{" "}
                  {s.avgTop10NotMeaningful ? (
                    <span className="text-muted-foreground">— *</span>
                  ) : (
                    <>{fmtSec(s.avgTop10LapSeconds ?? null)}s</>
                  )}
                </div>
                {(s.avgTop5NotMeaningful || s.avgTop10NotMeaningful) && (
                  <p className="font-sans text-[8px] text-muted-foreground leading-snug">
                    * Multi-lap averages need enough included laps on that run (same rule as Engineer summaries).
                  </p>
                )}
                {competitorsAvgTop10Line(s.paceVsFieldMetrics)}
              </div>
              {s.setupChangesFromPrevious.length > 0 ? (
                <div className="mt-1.5">
                  <Eyebrow>Setup changes</Eyebrow>
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
          );
        })}
      </div>
    </div>
  );
}
