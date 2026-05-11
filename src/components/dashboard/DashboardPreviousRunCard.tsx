"use client";

import { useState } from "react";
import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { cn } from "@/lib/utils";
import { DashboardEngineerSuggestionsPanel } from "@/components/dashboard/DashboardEngineerSuggestionsPanel";

type Recent = NonNullable<DashboardHomeModel["recentRun"]>;

function runCompleted(r: Recent): boolean {
  return Boolean(r.loggingCompletedAt) || r.loggingComplete;
}

export function DashboardPreviousRunCard({
  recentRun,
  displayTimeZone,
}: {
  recentRun: DashboardHomeModel["recentRun"];
  displayTimeZone: string;
}) {
  const [tab, setTab] = useState<"run" | "suggestions">("run");
  const showTabs = recentRun != null && runCompleted(recentRun);

  return (
    <CardPanel className="shadow-black/30 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">Last run</div>
        {showTabs ? (
          <div className="flex rounded-md border border-border bg-muted/40 p-0.5 text-[10px] font-medium">
            <button
              type="button"
              className={cn(
                "rounded px-2 py-0.5 transition",
                tab === "run" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setTab("run")}
            >
              Run
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-2 py-0.5 transition",
                tab === "suggestions"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setTab("suggestions")}
            >
              Engineer suggestions
            </button>
          </div>
        ) : null}
      </div>
      {recentRun ? (
        tab === "suggestions" && showTabs ? (
          <div className="mt-2">
            <DashboardEngineerSuggestionsPanel runId={recentRun.id} />
          </div>
        ) : (
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
        )
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">No runs yet — log one to populate this.</p>
      )}
    </CardPanel>
  );
}
