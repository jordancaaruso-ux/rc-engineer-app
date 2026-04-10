"use client";

import Link from "next/link";
import type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";
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

          return (
            <li
              key={`${p.importedLapTimeSessionId}-${p.promptKind}`}
              className="flex flex-col gap-2 rounded-md border border-border bg-card/80 p-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-[11px] leading-snug">
                <div className="font-medium text-foreground">{title}</div>
                <div className="mt-0.5 text-muted-foreground">
                  <span className="text-foreground/90">{p.eventName}</span>
                  {p.sourceType === "practice" ? (
                    <>
                      {" · "}
                      <span>{p.displayDriverName}</span>
                      {" · "}
                      <span className="font-mono tabular-nums">{timeLabel}</span>
                      {" · "}
                      <span>{lapsLabel}</span>
                    </>
                  ) : (
                    <>
                      {" · "}
                      <span>{p.className ?? "Race"}</span>
                      {" · "}
                      <span className="font-mono tabular-nums">{timeLabel}</span>
                      {" · "}
                      <span>{lapsLabel}</span>
                    </>
                  )}
                </div>
                {p.sourceType === "race" ? (
                  <div className="mt-0.5 text-[10px] italic text-muted-foreground">Full field loaded; your row preselected</div>
                ) : null}
              </div>
              <Link href={promptHref(p)} className={`${btnPrimary()} shrink-0 self-start sm:self-auto`}>
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
