"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { BetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import type { EngineerLapMetricFlag } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { cn } from "@/lib/utils";

function scopeLine(h: BetweenRunHintPayload): string {
  const bits = [h.scope.carLabel];
  if (h.scope.trackLabel) bits.push(h.scope.trackLabel);
  if (h.scope.eventLabel) bits.push(h.scope.eventLabel);
  return bits.join(" · ");
}

function fmtSec(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function lapVsPriorLabel(flag: EngineerLapMetricFlag | null): string {
  if (!flag) return "—";
  if (flag === "improved") return "Best lap vs prior: faster";
  if (flag === "regressed") return "Best lap vs prior: slower";
  if (flag === "flat") return "Best lap vs prior: similar";
  return "Best lap vs prior: unclear";
}

function lapVsPriorClass(flag: EngineerLapMetricFlag | null): string {
  if (flag === "improved") return "text-emerald-600 dark:text-emerald-400";
  if (flag === "regressed") return "text-rose-600 dark:text-rose-400";
  if (flag === "flat") return "text-muted-foreground";
  return "text-muted-foreground";
}

export function EngineerBetweenRunHintsStrip({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId")?.trim() || "";

  const [hint, setHint] = useState<BetweenRunHintPayload | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHint(undefined);
    setError(null);

    const qs = new URLSearchParams();
    if (runId) qs.set("runId", runId);
    qs.set("sync", "1");

    void fetch(`/api/engineer/between-run-hints?${qs.toString()}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { hint?: BetweenRunHintPayload | null; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not load hints");
          setHint(null);
          return;
        }
        if (cancelled) return;
        setHint(data.hint ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load hints");
          setHint(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (hint === undefined && !error) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground",
          className
        )}
      >
        Loading things to consider…
      </div>
    );
  }

  if (error || !hint) {
    return null;
  }

  const sessions = hint.recentSessions ?? [];
  const ctx = hint.driverContextPack;

  return (
    <div
      className={cn(
        "rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 shadow-sm",
        className
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">Things to consider</h2>
            <span className="text-[11px] text-muted-foreground">{scopeLine(hint)}</span>
          </div>

          {sessions.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Recent sessions (newest first)
              </div>
              <div className="grid gap-2 sm:grid-cols-1">
                {sessions.map((s, idx) => (
                  <div
                    key={s.runId}
                    className={cn(
                      "rounded-lg border border-border bg-card/70 px-3 py-2 text-[11px] leading-snug",
                      idx === 0 && "ring-1 ring-primary/25"
                    )}
                  >
                    <div className="font-medium text-foreground/95">{s.displayLabel}</div>
                    <div className="mt-1.5 grid gap-1 font-mono text-[10px] text-foreground/90 tabular-nums sm:grid-cols-2">
                      <div>
                        <span className="text-muted-foreground font-sans">Best lap</span>{" "}
                        <span>{fmtSec(s.bestLapSeconds)}s</span>
                      </div>
                      <div className={cn("font-sans text-[10px]", lapVsPriorClass(s.bestLapVsPreviousFlag))}>
                        {lapVsPriorLabel(s.bestLapVsPreviousFlag)}
                      </div>
                    </div>
                    {s.paceVsFieldSummary ? (
                      <p className="mt-1.5 text-[10px] text-muted-foreground leading-snug">
                        <span className="font-medium text-foreground/80">Pace vs field:</span> {s.paceVsFieldSummary}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[10px] text-muted-foreground leading-snug">
                        Pace vs field: not available (needs multi-driver imported timing for this session).
                      </p>
                    )}
                    {s.setupChangesFromPrevious.length > 0 ? (
                      <div className="mt-1.5">
                        <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                          Setup vs prior session
                        </div>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-muted-foreground">
                          {s.setupChangesFromPrevious.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[10px] text-muted-foreground">No setup deltas vs prior on record.</p>
                    )}
                    {(s.notesPreview || s.handlingPreview) && (
                      <div className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5 text-[10px] text-muted-foreground">
                        {s.notesPreview ? (
                          <p>
                            <span className="font-medium text-foreground/80">Notes:</span> {s.notesPreview}
                          </p>
                        ) : null}
                        {s.handlingPreview ? (
                          <p>
                            <span className="font-medium text-foreground/80">Handling:</span> {s.handlingPreview}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(ctx?.combinedNotesAndHandling?.trim() || (ctx?.currentSetupLines?.length ?? 0) > 0) && (
            <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[11px] leading-snug space-y-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Context for suggestions
              </div>
              {ctx.combinedNotesAndHandling?.trim() ? (
                <p className="text-muted-foreground whitespace-pre-wrap">{ctx.combinedNotesAndHandling.trim()}</p>
              ) : null}
              {ctx.currentSetupLines?.length ? (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Current setup (tuning keys)</div>
                  <ul className="list-disc space-y-0.5 pl-3.5 text-muted-foreground">
                    {ctx.currentSetupLines.slice(0, 18).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          <div className="space-y-1 border-t border-border/60 pt-2">
            <p className="text-sm font-medium text-foreground leading-snug">{hint.headline}</p>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
              {hint.bullets.slice(0, 4).map((b, i) => (
                <li key={i} className="leading-snug">
                  {b}
                </li>
              ))}
            </ul>
          </div>
          {hint.avoidRepeating ? (
            <p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-xs text-foreground leading-snug">
              {hint.avoidRepeating}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground leading-snug">{hint.sourcesNote}</p>
        </div>
        <Link
          href={hint.engineerHref}
          className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted/60"
        >
          Focus in Engineer
        </Link>
      </div>
    </div>
  );
}
