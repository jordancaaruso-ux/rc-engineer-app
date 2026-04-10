"use client";

import Link from "next/link";
import type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";
import { formatAppTimestampUtc } from "@/lib/formatDate";
import { formatLap } from "@/lib/runLaps";

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
  if (prompts.length === 0) return null;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 shadow-sm shadow-black/20">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Detected sessions
      </div>
      <ul className="mt-2 space-y-2">
        {prompts.map((p) => {
          const title =
            p.promptKind === "finish" ? "Finish logging this run" : "Log this run";
          const timeLabel = formatLap(p.bestLapSeconds);
          const lapsLabel = p.lapCount != null ? `${p.lapCount} lap${p.lapCount === 1 ? "" : "s"}` : "—";
          const whenUtc = formatPromptSessionWhen(p.sessionCompletedAtIso);
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
                      Session time (UTC)
                    </span>
                    <span className="ml-1.5 font-mono tabular-nums text-foreground/90">{whenUtc}</span>
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
              <Link href={promptHref(p)} className={`${btnPrimary()} shrink-0 self-start sm:mt-0.5`}>
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
