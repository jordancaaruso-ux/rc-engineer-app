"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { DashboardIncompleteRunRow } from "@/lib/dashboardServer";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { cn } from "@/lib/utils";
function btnPrimary(className = "") {
  return `inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 ${className}`;
}

function btnGhost(className = "") {
  return `inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted/60 ${className}`;
}

/**
 * When logging a detected LiveRC session, offer linking timing to an existing draft run instead of always creating a new row.
 */
export function NewRunImportLinkChooser({
  incompleteRuns,
  importedLapTimeSessionId,
  eventId,
  displayTimeZone,
  children,
}: {
  incompleteRuns: DashboardIncompleteRunRow[];
  importedLapTimeSessionId: string | null;
  eventId: string | null;
  displayTimeZone: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [dismissedChooser, setDismissedChooser] = useState(false);
  const [dismissingRunId, setDismissingRunId] = useState<string | null>(null);

  const show =
    Boolean(importedLapTimeSessionId) && incompleteRuns.length > 0 && !dismissedChooser;

  async function dismissRunFromList(runId: string) {
    setDismissingRunId(runId);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/dismiss-incomplete-prompt`, {
        method: "POST",
      });
      if (res.ok) router.refresh();
    } finally {
      setDismissingRunId(null);
    }
  }

  if (!show) {
    return <>{children}</>;
  }

  const q = new URLSearchParams();
  if (importedLapTimeSessionId) q.set("importedLapTimeSessionId", importedLapTimeSessionId);
  if (eventId) q.set("eventId", eventId);
  const qs = q.toString();

  function linkToRun(runId: string) {
    router.replace(`/runs/${encodeURIComponent(runId)}/edit${qs ? `?${qs}` : ""}`);
  }

  function createNew() {
    setDismissedChooser(true);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Link timing to a saved run?</h2>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          You have run log drafts that aren&apos;t marked complete. Attach this LiveRC session to one of them, or
          create a new run. Dismiss removes a draft from this list (same as on the dashboard); it does not delete the
          run.
        </p>
        <ul className="mt-3 space-y-2">
          {incompleteRuns.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-md border border-border bg-card/90 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-[11px] leading-snug">
                <div className="font-medium text-foreground">{r.carName}</div>
                <div className="text-muted-foreground">
                  {r.eventName ? `${r.eventName} · ` : null}
                  {r.trackName ?? "—"}
                </div>
                <div className="text-foreground/90">{r.sessionLabel}</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground tabular-nums">
                  Saved{" "}
                  <RelativeTime
                    iso={r.createdAt}
                    fallback={formatRunCreatedAtDateTime(r.createdAt, displayTimeZone)}
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5 self-start sm:items-end">
                <button type="button" className={btnPrimary()} onClick={() => linkToRun(r.id)}>
                  Link timing to this run
                </button>
                <button
                  type="button"
                  disabled={dismissingRunId === r.id}
                  onClick={() => void dismissRunFromList(r.id)}
                  className={cn(
                    "text-[11px] font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground disabled:opacity-50"
                  )}
                >
                  {dismissingRunId === r.id ? "…" : "Dismiss"}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btnGhost()} onClick={createNew}>
            Create a new run instead
          </button>
        </div>
      </div>
      {dismissedChooser ? children : null}
    </div>
  );
}
