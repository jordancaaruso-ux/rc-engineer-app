"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { DashboardIncompleteRunRow } from "@/lib/dashboardServer";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { CardPanel } from "@/components/ui/CardPanel";

function btnPrimary(className = "") {
  return `inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 ${className}`;
}

function btnGhost(className = "") {
  return `inline-flex items-center justify-center rounded-lg border border-border bg-surface-runna px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-runna-inset ${className}`;
}

/**
 * Shown when a "new run — tap to log it" notification (or `?resume=1`) opens Add Run and
 * the driver already has an in-progress draft from today. Continuing the draft preserves
 * any pre-run setup / tyres / conditions logged before the run; "start a new run" falls
 * through to the normal blank form. No lap import — laps are added the normal way.
 */
export function ResumeDraftChooser({
  drafts,
  displayTimeZone,
  children,
}: {
  drafts: DashboardIncompleteRunRow[];
  displayTimeZone: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [startNew, setStartNew] = useState(false);

  if (drafts.length === 0 || startNew) {
    return <>{children}</>;
  }

  function continueRun(runId: string) {
    router.replace(`/runs/${encodeURIComponent(runId)}/edit`);
  }

  return (
    <div className="space-y-4">
      <CardPanel>
        <h2 className="text-sm font-semibold text-foreground">Continue your run log?</h2>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          You started logging {drafts.length === 1 ? "a run" : "these runs"} earlier today. Pick it back
          up so the setup and notes you logged before the run carry over — or start a fresh run.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {drafts.map((r) => (
            <li key={r.id}>
              <CardPanel contentClassName="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-[11px] leading-snug">
                  <div className="font-medium text-foreground">{r.carName}</div>
                  <div className="text-muted-foreground">
                    {r.eventName ? `${r.eventName} · ` : null}
                    {r.trackName ?? "—"}
                  </div>
                  <div className="text-foreground/90">{r.sessionLabel}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                    Saved{" "}
                    <RelativeTime
                      iso={r.createdAt}
                      fallback={formatRunCreatedAtDateTime(r.createdAt, displayTimeZone)}
                    />
                  </div>
                </div>
                <div className="shrink-0 self-start sm:self-center">
                  <button type="button" className={btnPrimary()} onClick={() => continueRun(r.id)}>
                    Continue this run
                  </button>
                </div>
              </CardPanel>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <button type="button" className={btnGhost()} onClick={() => setStartNew(true)}>
            Start a new run instead
          </button>
        </div>
      </CardPanel>
    </div>
  );
}
