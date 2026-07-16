import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, HubRowTitle, StatStrip, StatTile } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { formatAppTimestampUtc } from "@/lib/formatDate";

const GAIN = "text-[#4FD089]";
const LOSS = "text-destructive";

/** "Front sway 1.4 → 1.5 · +2 more" from the final run's setup diff. */
function changedSummary(
  changes: NonNullable<DashboardHomeModel["recentRun"]>["setupChanges"]
): string | null {
  if (!changes || changes.length === 0) return null;
  const shown = changes.slice(0, 3).map((row) => {
    const unit = row.unit ? ` ${row.unit}` : "";
    return row.previous != null
      ? `${row.label} ${row.previous} → ${row.current}${unit}`
      : `${row.label} ${row.current}${unit}`;
  });
  const extra = changes.length - shown.length;
  return extra > 0 ? `${shown.join(" · ")} · +${extra} more` : shown.join(" · ");
}

/**
 * Off-day "last time out" digest — when/where, the day's pace, pace vs the
 * previous visit to that track, how the car felt, and what changed on the final
 * run. Absorbs the previous-run card (docs/DASHBOARD_NORTH_STAR.md, 2026-07-16).
 * One glance; the full debrief lives behind the tap in Sessions.
 */
export function DashboardLastSessionDigestCard({
  digest,
  recentRun,
}: {
  digest: NonNullable<DashboardHomeModel["lastSessionDigest"]>;
  recentRun: DashboardHomeModel["recentRun"];
}) {
  const changes = changedSummary(recentRun?.setupChanges ?? null);
  const delta = digest.bestDeltaVsPrevVisit;
  const rating = recentRun?.carRating ?? null;

  return (
    <CardPanel className="relative">
      <Link
        href="/runs/history?expandLatest=1"
        prefetch
        aria-label="Open the last session in Sessions"
        className="tap-active absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <div className="pointer-events-none relative z-10">
        <Eyebrow>Last time out</Eyebrow>

        <div className="mt-1.5 min-w-0">
          <HubRowTitle as="h3">{digest.trackName ?? "Session"}</HubRowTitle>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            <RelativeTime
              iso={digest.dateIso}
              fallback={formatAppTimestampUtc(digest.dateIso)}
            />
            {" · "}
            {digest.runCount} {digest.runCount === 1 ? "run" : "runs"}
          </p>
        </div>

        <StatStrip className="mt-2.5" gridClassName="grid-cols-3">
          <StatTile label="Best lap" value={formatLap(digest.bestLap)} accent className="py-2" />
          <StatTile
            label="vs last visit"
            value={
              delta != null ? (
                <span className={cn(delta < 0 ? GAIN : LOSS)}>
                  {delta < 0 ? "−" : "+"}
                  {Math.abs(delta).toFixed(3)}
                </span>
              ) : (
                "—"
              )
            }
            className="py-2"
          />
          <StatTile
            label="Car feel"
            value={rating != null ? `${rating}/10` : "—"}
            className="py-2"
          />
        </StatStrip>

        {changes ? (
          <div className="mt-2.5 border-t border-border/70 pt-2.5">
            <div className="type-data-label">Changed on the final run</div>
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {changes}
            </p>
          </div>
        ) : null}
      </div>
    </CardPanel>
  );
}
