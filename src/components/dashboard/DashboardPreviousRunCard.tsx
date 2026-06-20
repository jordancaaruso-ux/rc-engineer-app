"use client";

import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { CardPanel } from "@/components/ui/CardPanel";
import { SectionMetaInline } from "@/components/ui/SectionTitle";
import { Eyebrow, PanelSubtitle, PanelTitle, StatStrip, StatTile } from "@/components/ui/panel";
import { EngineerQuickFixButton } from "@/components/engineer/EngineerQuickFixButton";

function formatCarRating(rating: number | null | undefined): string {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating < 1 || rating > 10) {
    return "—";
  }
  return `${Math.round(rating)}/10`;
}

export function DashboardPreviousRunCard({
  recentRun,
  displayTimeZone,
}: {
  recentRun: DashboardHomeModel["recentRun"];
  displayTimeZone: string;
}) {
  const viewRunHref = recentRun
    ? `/runs/history?focusRun=${encodeURIComponent(recentRun.id)}`
    : null;

  return (
    <CardPanel className={viewRunHref ? "relative" : undefined}>
      <Eyebrow dot="muted">Last run</Eyebrow>
      {recentRun && viewRunHref ? (
        <>
          <Link
            href={viewRunHref}
            prefetch
            aria-label="View last run"
            className="tap-active absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <div className="relative z-10 mt-1.5 space-y-2 pointer-events-none">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
              <PanelTitle as="h3" className="shrink-0">
                {recentRun.carName}
              </PanelTitle>
              <SectionMetaInline className="min-w-0 truncate">
                {recentRun.trackName ?? "No track"} · {recentRun.sessionLabel}
              </SectionMetaInline>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">When</span>
              <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                {formatRunCreatedAtDateTime(
                  resolveRunDisplayInstant({
                    createdAt: recentRun.createdAt,
                    sessionCompletedAt: recentRun.sessionCompletedAt,
                    loggingCompletedAt: recentRun.loggingCompletedAt,
                  }),
                  displayTimeZone
                )}
              </span>
              {recentRun.eventName ? (
                <>
                  <span className="text-faint" aria-hidden>
                    ·
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Event</span>
                  <span className="ui-caption truncate">{recentRun.eventName}</span>
                </>
              ) : null}
            </div>
            <StatStrip className="grid-cols-3">
              <StatTile label="Best lap" value={formatLap(recentRun.bestLap)} accent className="py-2" />
              <StatTile label="Avg top 5" value={formatLap(recentRun.avgTop5)} className="py-2" />
              <StatTile label="Car rating" value={formatCarRating(recentRun.carRating)} className="py-2" />
            </StatStrip>
            <div
              className="pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <EngineerQuickFixButton runId={recentRun.id} />
            </div>
          </div>
        </>
      ) : (
        <PanelSubtitle className="mt-1.5">No runs yet — log one to populate this.</PanelSubtitle>
      )}
    </CardPanel>
  );
}
