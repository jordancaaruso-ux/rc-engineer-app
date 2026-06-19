"use client";

import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, PanelSubtitle, PanelTitle, StatStrip, StatTile } from "@/components/ui/panel";

export function DashboardPreviousRunCard({
  recentRun,
  displayTimeZone,
}: {
  recentRun: DashboardHomeModel["recentRun"];
  displayTimeZone: string;
}) {
  return (
    <CardPanel>
      <Eyebrow dot="muted">Last run</Eyebrow>
      {recentRun ? (
        <div className="mt-1.5 space-y-2.5">
          <div>
            <PanelTitle as="h3">{recentRun.carName}</PanelTitle>
            <PanelSubtitle className="mt-1">
              {recentRun.trackName ?? "No track"} · {recentRun.sessionLabel}
            </PanelSubtitle>
          </div>
          <div className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[4.5rem_1fr]">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">When</span>
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
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">Event</span>
                <span className="text-[13px] text-muted-foreground">{recentRun.eventName}</span>
              </>
            ) : null}
          </div>
          <StatStrip className="grid-cols-2">
            <StatTile label="Best lap" value={formatLap(recentRun.bestLap)} accent className="py-2" />
            <StatTile label="Avg top 5" value={formatLap(recentRun.avgTop5)} className="py-2" />
          </StatStrip>
          <div className="flex flex-wrap gap-1.5">
            <Link
              href={`/runs/history?focusRun=${encodeURIComponent(recentRun.id)}`}
              className={buttonLinkClassName("outline", "text-muted-foreground hover:text-foreground")}
            >
              View run
            </Link>
            <Link
              href={`/runs/${encodeURIComponent(recentRun.id)}/edit`}
              className={buttonLinkClassName("outline", "text-muted-foreground hover:text-foreground")}
            >
              Edit run
            </Link>
          </div>
        </div>
      ) : (
        <PanelSubtitle className="mt-1.5">No runs yet — log one to populate this.</PanelSubtitle>
      )}
    </CardPanel>
  );
}
