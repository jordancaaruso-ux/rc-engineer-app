"use client";

import Link from "next/link";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { formatPaceDelta } from "@/lib/teams/teamFeedModel";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import { TeamCommentThread } from "@/components/teams/TeamCommentThread";
import type { TeamFeedEntryView } from "@/lib/teams/loadTeamFeed";

/** Pace deltas only — green/red mean faster/slower, never "good"/"bad" (VISUAL_NORTH_STAR). */
const GAIN = "text-gain";

/**
 * One run in the team feed: was it better, what did they change, what else moved.
 *
 * The card deliberately stops there. It never rules on whether the change caused the
 * gain — no verdict chip, no confidence, no "confounded" flag. `Changed` and `Also moved`
 * sit side by side at equal weight and the driver draws the conclusion.
 */
export function TeamFeedEntryCard({
  entry,
  teamId,
  highlighted = false,
}: {
  entry: TeamFeedEntryView;
  teamId: string;
  /** Set for a run deep-linked from a comment notification. */
  highlighted?: boolean;
}) {
  const paceDelta = formatPaceDelta(entry.paceDeltaSeconds);
  const isGain = entry.paceDeltaSeconds != null && entry.paceDeltaSeconds < 0;
  const isLoss = entry.paceDeltaSeconds != null && entry.paceDeltaSeconds > 0;

  // Logged well after the session ended — worth saying so, because a feed with mixed
  // logging latency is otherwise silently misleading about how fresh it is.
  const logLagMs = new Date(entry.loggedAt).getTime() - new Date(entry.occurredAt).getTime();
  const loggedLate = logLagMs > 45 * 60 * 1000;

  const context = [entry.carName, entry.trackName, entry.raceClass].filter(Boolean).join(" · ");

  return (
    <SurfaceCard
      variant="panel"
      className={cn(highlighted && "ring-1 ring-primary-ink/50")}
      contentClassName="p-0"
    >
      <div id={`run-${entry.runId}`} className="scroll-mt-20">
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
          <div className="min-w-0">
            <p className="ui-title truncate text-[14px] font-semibold text-foreground">
              {entry.ownerLabel}
            </p>
            <p className="type-timestamp mt-0.5 truncate">
              {entry.sessionLabel}
              {context ? ` · ${context}` : ""}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <RelativeTime iso={entry.occurredAt} fallback="—" display="relative" />
            {loggedLate ? (
              <p className="type-timestamp opacity-70">
                logged <RelativeTime iso={entry.loggedAt} fallback="later" display="relative" />
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-baseline gap-2.5 px-4 pb-3 pt-2">
          <span className="text-[26px] font-medium leading-none tabular-nums text-foreground">
            {entry.bestLapSeconds != null ? formatLap(entry.bestLapSeconds) : "—"}
          </span>
          {paceDelta ? (
            <span
              className={cn(
                "text-[13px] font-medium tabular-nums",
                isGain && GAIN,
                isLoss && "text-destructive",
                !isGain && !isLoss && "text-muted-foreground"
              )}
            >
              {paceDelta}
            </span>
          ) : (
            <span className="type-timestamp">First run of the day</span>
          )}
        </div>

        {entry.baselineRunId ? (
          <div className="border-t border-border/60">
            <FactRow
              label="Changed"
              empty="No setup change"
              overflow={entry.changedOverflow}
              rows={entry.changed.map((row) => ({
                key: row.key,
                text: (
                  <>
                    <span className="text-muted-foreground">{row.label}</span>{" "}
                    <span className="tabular-nums text-foreground">
                      {row.previousValue} → {row.value}
                    </span>
                  </>
                ),
              }))}
            />
            <FactRow
              label="Also moved"
              empty="Nothing else moved"
              overflow={entry.alsoMovedOverflow}
              rows={entry.alsoMoved.map((row, i) => ({
                key: `${row.kind}-${i}`,
                text: (
                  <>
                    <span className="text-muted-foreground">{row.label}</span>{" "}
                    <span className="tabular-nums text-foreground">{row.detail}</span>
                  </>
                ),
              }))}
            />
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2">
          <Link
            href={`/runs/${encodeURIComponent(entry.runId)}`}
            className="type-timestamp text-primary-ink underline underline-offset-2"
          >
            Open session
          </Link>
        </div>

        <TeamCommentThread teamId={teamId} runId={entry.runId} initialComments={entry.comments} />
      </div>
    </SurfaceCard>
  );
}

/**
 * A labelled block of facts. The empty state is a sentence, not a blank — "Nothing else
 * moved" is real information about how clean the comparison was, and leaving it out would
 * quietly turn an informative absence into an oversight.
 */
function FactRow({
  label,
  rows,
  empty,
  overflow,
}: {
  label: string;
  rows: Array<{ key: string; text: React.ReactNode }>;
  empty: string;
  overflow: number;
}) {
  return (
    <div className="border-b border-border/40 px-4 py-2.5 last:border-b-0">
      <Eyebrow className="mb-1.5">{label}</Eyebrow>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="text-[13px] leading-snug">
              {row.text}
            </li>
          ))}
          {overflow > 0 ? (
            <li className="type-timestamp">and {overflow} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
