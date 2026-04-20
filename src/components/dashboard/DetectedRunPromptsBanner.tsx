"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";
import { formatAppTimestampUtc } from "@/lib/formatDate";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";

function btnPrimary(className = "") {
  return `inline-flex items-center justify-center rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 ${className}`;
}

function promptHref(p: DetectedRunPrompt): string {
  if (p.promptKind === "finish" && p.runId) {
    return `/runs/${encodeURIComponent(p.runId)}/edit`;
  }
  const q = new URLSearchParams();
  q.set("importedLapTimeSessionId", p.importedLapTimeSessionId);
  q.set("eventId", p.eventId);
  return `/runs/new?${q.toString()}`;
}

function formatPromptSessionWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatAppTimestampUtc(iso);
}

export function DetectedRunPromptsBanner({ prompts }: { prompts: DetectedRunPrompt[] }) {
  const router = useRouter();
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissErr, setDismissErr] = useState<string | null>(null);

  async function dismiss(importedLapTimeSessionId: string) {
    setDismissErr(null);
    setDismissingId(importedLapTimeSessionId);
    try {
      const res = await fetch(
        `/api/lap-time-sessions/${encodeURIComponent(importedLapTimeSessionId)}/dismiss-detection-prompt`,
        { method: "POST" }
      );
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

  if (prompts.length === 0) return null;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 shadow-sm shadow-black/20">
      <div className="space-y-0.5">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Detected sessions
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Dismiss hides a session from this list without deleting the imported timing data.
        </p>
      </div>
      {dismissErr ? <p className="text-[11px] text-destructive">{dismissErr}</p> : null}
      <ul className="mt-2 space-y-2">
        {prompts.map((p) => {
          const title =
            p.promptKind === "finish" ? "Finish logging this run" : "Log this run";
          const timeLabel = formatLap(p.bestLapSeconds);
          const lapsLabel = p.lapCount != null ? `${p.lapCount} lap${p.lapCount === 1 ? "" : "s"}` : "—";
          const whenFallback = formatPromptSessionWhen(p.sessionCompletedAtIso);
          const kindLabel = p.sourceType === "practice" ? "Practice" : "Race / qualifying";
          const sessionTitle =
            p.sessionListLabel?.trim() ||
            (p.sourceType === "race" ? (p.className?.trim() || "Race session") : p.displayDriverName);

          return (
            <li
              key={`${p.importedLapTimeSessionId}-${p.promptKind}`}
              className="flex flex-col gap-2 rounded-md border border-border bg-card/80 p-2.5 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1 text-[11px] leading-snug">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                    {kindLabel}
                  </span>
                  <span className="font-medium text-foreground">{title}</span>
                </div>
                <div className="mt-1 text-foreground/90">{p.eventName}</div>
                <div className="mt-0.5 font-medium text-foreground break-words">{sessionTitle}</div>
                <div className="mt-1 space-y-0.5 text-muted-foreground">
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90">
                      Session time
                    </span>
                    <span className="ml-1.5 font-mono tabular-nums text-foreground/90">
                      <RelativeTime
                        iso={p.sessionCompletedAtIso}
                        fallback={whenFallback}
                        display="combo"
                      />
                    </span>
                  </div>
                  {p.sourceType === "practice" ? (
                    <div>Driver (your laps): {p.displayDriverName}</div>
                  ) : (
                    <div>
                      Class filter: {p.className ?? "—"} · Your row: {p.displayDriverName}
                    </div>
                  )}
                  <div>
                    Best lap {timeLabel} · {lapsLabel}
                  </div>
                </div>
                {p.sourceType === "race" ? (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Full field loaded in Log your run; your driver is preselected.
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-1.5 self-start sm:mt-0.5 sm:items-end">
                <Link href={promptHref(p)} className={`${btnPrimary()} w-full sm:w-auto text-center`}>
                  {title}
                </Link>
                <button
                  type="button"
                  disabled={dismissingId === p.importedLapTimeSessionId}
                  onClick={() => void dismiss(p.importedLapTimeSessionId)}
                  aria-label="Dismiss: hide this session from detected prompts without logging a run"
                  className={cn(
                    "text-[11px] font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground disabled:opacity-50"
                  )}
                >
                  {dismissingId === p.importedLapTimeSessionId ? "…" : "Dismiss"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
