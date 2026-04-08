import Link from "next/link";
import type { DashboardActionItemRow, DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { ThingsToTrySection } from "@/components/dashboard/ThingsToTrySection";

function btnGhost(className = "") {
  return `inline-flex items-center justify-center rounded-lg border border-border bg-card/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-muted/60 hover:text-foreground ${className}`;
}

export function DashboardWorkflowContext({
  recentRun,
  thingsToTry,
}: {
  recentRun: DashboardHomeModel["recentRun"];
  thingsToTry: DashboardActionItemRow[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/30">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workflow context</div>
      <p className="mt-1 max-w-xl text-[10px] leading-snug text-muted-foreground">
        Latest saved run and your persistent &quot;things to try&quot; — carried through analysis, logging, and engineer chat.
      </p>

      <div className="mt-3 rounded-md border border-border bg-muted/40 p-2.5">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Last run</div>
        {recentRun ? (
          <div className="mt-2 space-y-2 text-[11px]">
            <div className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 sm:grid-cols-[4.5rem_1fr]">
              <span className="text-muted-foreground">When</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatRunCreatedAtDateTime(recentRun.createdAt)}
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
              <Link href="/runs/history" className={btnGhost()}>
                Open analysis
              </Link>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">No runs yet — log one to populate this.</p>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <ThingsToTrySection initialItems={thingsToTry} embedded />
      </div>
    </div>
  );
}
