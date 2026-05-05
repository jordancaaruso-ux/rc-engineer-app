"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { engineerQuickPromptDisabled, engineerQuickPromptsForSurface } from "@/lib/engineerQuickPrompts";
import { formatConsistencyScorePercent } from "@/lib/lapAnalysis";

function fmtSec(v: number | null | undefined, notMeaningful?: boolean): string {
  if (notMeaningful) return "—";
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function fmtDeltaSec(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(3)}s`;
}

function fmtDeltaScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

function flagClass(flag: string): string {
  if (flag === "improved") return "text-emerald-600 dark:text-emerald-400";
  if (flag === "regressed") return "text-rose-600 dark:text-rose-400";
  if (flag === "flat") return "text-muted-foreground";
  return "text-muted-foreground";
}

const quickAskBtnClass =
  "inline-flex items-center rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/60 transition disabled:opacity-40 disabled:cursor-not-allowed";

export function EngineerRunSummaryPanel({
  runId,
  compareRunId,
  defaultExpanded = true,
  onQueueEngineerChatPrompt,
  onCompareSetupsWithEngineer,
  onCompareLaptimesWithEngineer,
}: {
  runId: string;
  /** When set, summary compares this run to `compareRunId` (teammate allowed if linked). */
  compareRunId?: string | null;
  /** Collapse details for dense layouts */
  defaultExpanded?: boolean;
  /** Engineer page: send a canned prompt (preferred — shows full quick-ask bar). */
  onQueueEngineerChatPrompt?: (text: string) => void;
  /** Legacy: single “compare setups” action when `onQueueEngineerChatPrompt` is not used. */
  onCompareSetupsWithEngineer?: () => void;
  /** Legacy: single “compare lap times” action when `onQueueEngineerChatPrompt` is not used. */
  onCompareLaptimesWithEngineer?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<EngineerRunSummaryV2 | null>(null);
  const [cached, setCached] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      const c = compareRunId?.trim();
      if (c) qs.set("compareRunId", c);
      const url = `/api/runs/${encodeURIComponent(runId)}/engineer-summary${qs.toString() ? `?${qs}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr((data as { error?: string })?.error ?? "Could not load summary.");
        setSummary(null);
        return;
      }
      setSummary((data as { summary?: EngineerRunSummaryV2 }).summary ?? null);
      setCached(Boolean((data as { cached?: boolean }).cached));
    } catch {
      setErr("Could not load summary.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [runId, compareRunId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !summary) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-[11px] text-muted-foreground">Loading engineer summary…</div>
    );
  }
  if (err) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-[11px] text-destructive">{err}</div>;
  }
  if (!summary) return null;

  const lo = summary.lapOutcome;
  const engineerChatHref = `/engineer?runId=${encodeURIComponent(runId)}`;
  const hasCompareInUrl = Boolean(compareRunId?.trim());
  const runSummaryQuickPrompts = engineerQuickPromptsForSurface("run_summary");

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition"
      >
        <div className="ui-title text-[10px] uppercase tracking-wide text-muted-foreground">Engineer summary</div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {cached && !compareRunId?.trim() ? <span>cached</span> : null}
          <span>{expanded ? "▼" : "▶"}</span>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-border px-3 py-3 space-y-3 text-[11px] leading-snug">
          {onQueueEngineerChatPrompt ? (
            <div className="space-y-1.5 pb-1 border-b border-border/60">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Ask the Engineer
              </div>
              <div className="flex flex-wrap gap-1.5">
                {runSummaryQuickPrompts.map((def) => {
                  const dis = engineerQuickPromptDisabled(def, {
                    hasRunId: true,
                    hasCompareRunId: hasCompareInUrl,
                    hasPatternDigest: false,
                  });
                  const title = dis
                    ? def.requiresCompare
                      ? "Select a compare run in the bar above first"
                      : "Unavailable"
                    : def.label;
                  return (
                    <button
                      key={def.id}
                      type="button"
                      title={title}
                      disabled={dis}
                      className={quickAskBtnClass}
                      onClick={() => onQueueEngineerChatPrompt(def.prompt)}
                    >
                      {def.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : onCompareSetupsWithEngineer || onCompareLaptimesWithEngineer ? (
            <div className="flex flex-wrap gap-2 pb-1 border-b border-border/60">
              {onCompareSetupsWithEngineer ? (
                <button type="button" className={quickAskBtnClass} onClick={onCompareSetupsWithEngineer}>
                  Compare setups with Engineer
                </button>
              ) : null}
              {onCompareLaptimesWithEngineer ? (
                <button type="button" className={quickAskBtnClass} onClick={onCompareLaptimesWithEngineer}>
                  Compare lap times with Engineer
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="text-muted-foreground">
            {summary.referenceLabel ? (
              <>
                Compared to: <span className="text-foreground/90">{summary.referenceLabel}</span>
              </>
            ) : (
              "No earlier run on this car to compare."
            )}
          </div>
          {summary.importedProvenance ? (
            <div className="text-muted-foreground">
              Timing source: <span className="text-foreground/90">{summary.importedProvenance}</span>
            </div>
          ) : null}

          {summary.fieldImportSession && summary.fieldImportSession.ranked.length >= 2 ? (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Imported session — field
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Same timing import, multiple drivers. Rank and gap use each driver&apos;s best included lap vs session
                best. Fade is mean(second half) − mean(first half) of included laps (needs ≥4 laps).
              </p>
              <div className="md:hidden space-y-1.5">
                {summary.fieldImportSession.ranked.map((row, i) => (
                  <div
                    key={`${row.label}-${i}-m`}
                    className={cn(
                      "rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[10px] leading-tight",
                      row.isPrimaryUser && "bg-primary/5"
                    )}
                  >
                    <div className="font-sans text-foreground/90">
                      {row.label}
                      {row.isPrimaryUser ? (
                        <span className="ml-1 text-[9px] text-muted-foreground">(you)</span>
                      ) : null}
                    </div>
                    <div className="mt-1 grid grid-cols-4 gap-x-2 gap-y-0.5 font-mono text-[9px] text-foreground/85">
                      <span>
                        <span className="block text-[8px] font-sans text-muted-foreground">Rk</span>
                        {row.rank}
                      </span>
                      <span>
                        <span className="block text-[8px] font-sans text-muted-foreground">Best</span>
                        {fmtSec(row.bestLapSeconds)}
                      </span>
                      <span>
                        <span className="block text-[8px] font-sans text-muted-foreground">Gap</span>
                        {row.gapToSessionBestSeconds == null || !Number.isFinite(row.gapToSessionBestSeconds)
                          ? "—"
                          : row.gapToSessionBestSeconds.toFixed(3)}
                      </span>
                      <span>
                        <span className="block text-[8px] font-sans text-muted-foreground">Fade</span>
                        {fmtSec(row.fadeSeconds)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto rounded-md border border-border bg-muted/40">
                <table className="w-full text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Driver</th>
                      <th className="px-2 py-1.5 font-medium">Rank</th>
                      <th className="px-2 py-1.5 font-medium">Best</th>
                      <th className="px-2 py-1.5 font-medium">Gap to P1</th>
                      <th className="px-2 py-1.5 font-medium">Fade</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-foreground/90">
                    {summary.fieldImportSession.ranked.map((row, i) => (
                      <tr key={`${row.label}-${i}`} className={row.isPrimaryUser ? "bg-primary/5" : undefined}>
                        <td className="px-2 py-1">
                          {row.label}
                          {row.isPrimaryUser ? (
                            <span className="ml-1 text-[9px] text-muted-foreground font-sans">(your row)</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{row.rank}</td>
                        <td className="px-2 py-1 tabular-nums">{fmtSec(row.bestLapSeconds)}</td>
                        <td className="px-2 py-1 tabular-nums">
                          {row.gapToSessionBestSeconds == null || !Number.isFinite(row.gapToSessionBestSeconds)
                            ? "—"
                            : row.gapToSessionBestSeconds.toFixed(3)}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{fmtSec(row.fadeSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="md:hidden space-y-1.5">
            {(
              [
                ["Best", lo.best, "sec"],
                ["Avg top 5", lo.avgTop5, "sec"],
                ["Avg top 10", lo.avgTop10, "sec"],
                ["Avg top 15", lo.avgTop15, "sec"],
                ["Consistency", lo.consistencyScore, "score"],
              ] as const
            ).map(([label, m, kind]) => (
              <div
                key={`${label}-m`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[10px]"
              >
                <span className="font-medium text-foreground/85">{label}</span>
                <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-right text-[10px]">
                  <span>
                    {kind === "sec"
                      ? fmtSec(m.current, m.notMeaningful)
                      : m.current != null
                        ? formatConsistencyScorePercent(m.current)
                        : "—"}
                  </span>
                  <span className="text-muted-foreground">{kind === "sec" ? fmtDeltaSec(m.delta) : fmtDeltaScore(m.delta)}</span>
                  <span className={cn(flagClass(m.flag))}>{m.flag}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block rounded-md border border-border bg-muted/40 overflow-x-auto">
            <table className="w-full text-left text-[10px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1.5 px-2 font-medium">Metric</th>
                  <th className="py-1.5 px-2 font-medium">This run</th>
                  <th className="py-1.5 px-2 font-medium">Δ</th>
                  <th className="py-1.5 px-2 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody className="font-mono text-foreground/90">
                {(
                  [
                    ["Best", lo.best, "sec"],
                    ["Avg top 5", lo.avgTop5, "sec"],
                    ["Avg top 10", lo.avgTop10, "sec"],
                    ["Avg top 15", lo.avgTop15, "sec"],
                    ["Consistency", lo.consistencyScore, "score"],
                  ] as const
                ).map(([label, m, kind]) => (
                  <tr key={label} className="border-b border-border/60 last:border-0">
                    <td className="py-1 px-2 text-foreground/80">{label}</td>
                    <td className="py-1 px-2">
                      {kind === "sec"
                        ? fmtSec(m.current, m.notMeaningful)
                        : m.current != null
                          ? formatConsistencyScorePercent(m.current)
                          : "—"}
                    </td>
                    <td className="py-1 px-2">
                      {kind === "sec" ? fmtDeltaSec(m.delta) : fmtDeltaScore(m.delta)}
                    </td>
                    <td className={cn("py-1 px-2", flagClass(m.flag))}>{m.flag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-muted-foreground">
            Included laps: <span className="text-foreground/90 font-mono">{summary.lapCountIncluded.current}</span>
            {summary.lapCountIncluded.reference != null ? (
              <>
                {" "}
                vs ref <span className="text-foreground/90 font-mono">{summary.lapCountIncluded.reference}</span>
              </>
            ) : null}
          </div>

          {summary.setupChanges.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Key setup changes</div>
              <ul className="space-y-1 list-disc pl-4 text-foreground/90">
                {summary.setupChanges.map((s) => (
                  <li key={s.key}>
                    <span className="font-medium">{s.label}</span>: {s.before} → {s.after}
                  </li>
                ))}
              </ul>
            </div>
          ) : summary.referenceRunId ? (
            <div className="text-muted-foreground">No setup differences vs reference on record.</div>
          ) : null}

          <div className="rounded-md border border-border bg-muted/30 p-2 text-foreground/90">{summary.interpretation}</div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-border bg-background px-2 py-1 text-[10px] hover:bg-muted/60"
            >
              Refresh
            </button>
          </div>

          {!(onCompareSetupsWithEngineer || onCompareLaptimesWithEngineer) ? (
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-muted-foreground">
                Want to go deeper? Use the Engineer chat for questions and handling ideas about this run (optional).
              </p>
              <Link
                href={engineerChatHref}
                className="inline-flex rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground shadow-glow-sm hover:brightness-105"
              >
                Chat with Engineer
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
