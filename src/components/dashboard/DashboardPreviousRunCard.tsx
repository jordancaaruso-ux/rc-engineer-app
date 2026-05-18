"use client";

import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";

export function DashboardPreviousRunCard({
  recentRun,
  displayTimeZone,
}: {
  recentRun: DashboardHomeModel["recentRun"];
  displayTimeZone: string;
}) {
  return (
    <CardPanel className="shadow-black/30 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">Last run</div>
      </div>
      {recentRun ? (
        <div className="mt-2 space-y-2 text-[11px]">
          <div className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 sm:grid-cols-[4.5rem_1fr]">
            <span className="text-muted-foreground">When</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {formatRunCreatedAtDateTime(
                resolveRunDisplayInstant({
                  createdAt: recentRun.createdAt,
                  sessionCompletedAt: recentRun.sessionCompletedAt,
                  loggingCompletedAt: recentRun.loggingCompletedAt,
                }),
                displayTimeZone
              )}
            </span>
            <span className="text-muted-foreground">Car</span>
            <span className="min-w-0 font-medium text-foreground">{recentRun.carName}</span>
            <span className="text-muted-foreground">Track</span>
            <span className="min-w-0 text-muted-foreground">{recentRun.trackName ?? "—"}</span>
            {recentRun.eventName ? (
              <>
                <span className="text-muted-foreground">Event</span>
                <span className="min-w-0 text-muted-foreground">{recentRun.eventName}</span>
              </>
            ) : null}
            <span className="text-muted-foreground">Session</span>
            <span className="min-w-0 text-muted-foreground">{recentRun.sessionLabel}</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2">
            <span className="tabular-nums">
              <span className="mr-1.5 text-[10px] font-medium text-muted-foreground">Best</span>
              <span className="font-mono">{formatLap(recentRun.bestLap)}</span>
            </span>
            <span className="tabular-nums">
              <span className="mr-1.5 text-[10px] font-medium text-muted-foreground">Avg 5</span>
              <span className="font-mono">{formatLap(recentRun.avgTop5)}</span>
            </span>
          </div>
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
        <p className="mt-2 text-[11px] text-muted-foreground">No runs yet — log one to populate this.</p>
      )}
    </CardPanel>
  );
}
