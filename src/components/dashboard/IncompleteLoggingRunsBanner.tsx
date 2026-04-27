"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DashboardIncompleteRunRow } from "@/lib/dashboardServer";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { cn } from "@/lib/utils";

function btnPrimary(className = "") {
  return `inline-flex items-center justify-center rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 ${className}`;
}

export function IncompleteLoggingRunsBanner({
  rows,
  displayTimeZone,
}: {
  rows: DashboardIncompleteRunRow[];
  displayTimeZone: string;
}) {
  const router = useRouter();
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissErr, setDismissErr] = useState<string | null>(null);

  async function dismiss(runId: string) {
    setDismissErr(null);
    setDismissingId(runId);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/dismiss-incomplete-prompt`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDismissErr(data.error ?? "Could not dismiss.");
        return;
      }
      router.refresh();
    } finally {
      setDismissingId(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 shadow-sm shadow-black/20">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Runs not finished logging
      </div>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
        You saved details but didn&apos;t mark the run as completed. Open a run to add laps, notes, or finish up.
        Dismiss hides a run from this list without deleting it.
      </p>
      {dismissErr ? <p className="mt-2 text-[11px] text-destructive">{dismissErr}</p> : null}
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-card/80 p-2.5 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1 text-[11px] leading-snug">
              <div className="font-medium text-foreground">{r.carName}</div>
              <div className="text-muted-foreground">
                {r.eventName ? `${r.eventName} · ` : null}
                {r.trackName ?? "—"}
              </div>
              <div className="mt-0.5 text-foreground/90">{r.sessionLabel}</div>
              <div className="mt-1.5">
                <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Logging incomplete
                </span>
                <span className="ml-2 font-mono text-[10px] text-muted-foreground tabular-nums">
                  Saved{" "}
                  <RelativeTime
                    iso={r.createdAt}
                    fallback={formatRunCreatedAtDateTime(r.createdAt, displayTimeZone)}
                  />
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5 self-start sm:mt-0.5 sm:items-end">
              <Link href={`/runs/${encodeURIComponent(r.id)}/edit`} className={`${btnPrimary()} w-full sm:w-auto text-center`}>
                Complete logging
              </Link>
              <button
                type="button"
                disabled={dismissingId === r.id}
                onClick={() => void dismiss(r.id)}
                aria-label="Dismiss: hide this run from incomplete logging reminders"
                className={cn(
                  "text-[11px] font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground disabled:opacity-50"
                )}
              >
                {dismissingId === r.id ? "…" : "Dismiss"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
