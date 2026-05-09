"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import {
  EngineerPaceVsFieldPanel,
  fieldRelativityForSummary,
} from "@/components/engineer/EngineerPaceVsFieldPanel";
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
  const [fullSummaryOpen, setFullSummaryOpen] = useState(defaultExpanded);

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

  useEffect(() => {
    setFullSummaryOpen(defaultExpanded);
  }, [runId, compareRunId, defaultExpanded]);

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
  const fieldRel = fieldRelativityForSummary(summary);
  const engineerChatHref = `/engineer?runId=${encodeURIComponent(runId)}`;
  const hasCompareInUrl = Boolean(compareRunId?.trim());
  const runSummaryQuickPrompts = engineerQuickPromptsForSurface("run_summary");

  const showFullBody = defaultExpanded || fullSummaryOpen;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <div className="ui-title text-[10px] uppercase tracking-wide text-muted-foreground">Engineer summary</div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {cached && !compareRunId?.trim() ? <span>cached</span> : null}
        </div>
      </div>

      {!defaultExpanded ? (
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            className="text-[11px] font-medium text-primary hover:underline"
            onClick={() => setFullSummaryOpen((v) => !v)}
          >
            {fullSummaryOpen ? "Hide full engineer summary" : "Show full engineer summary"}
          </button>
        </div>
      ) : null}

      {showFullBody ? (
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

          <EngineerPaceVsFieldPanel summary={summary} />

          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Included lap metrics
            </div>
            {fieldRel.showVsFieldColumn ? (
              <p className="text-[10px] text-muted-foreground leading-snug">
                <span className="font-medium text-foreground/80">Vs field</span>{" "}
                {fieldRel.vsFieldUsesSessionMeans ? (
                  <>
                    compares each metric to the <span className="font-medium text-foreground/80">session field average</span>{" "}
                    (mean across entrants with data). Positive = slower than that average. Primary pace read is avg top 10;
                    rank in the pace panel uses avg top 10 when available.
                  </>
                ) : (
                  <>
                    uses gaps vs the fastest competitor on each metric (positive = slower). Link a full timing session for
                    field-average pacing.
                  </>
                )}
              </p>
            ) : null}
          </div>
          <div className="md:hidden space-y-1.5">
            {(
              [
                ["Best", lo.best, "sec", fieldRel.gapBest] as const,
                ["Avg top 5", lo.avgTop5, "sec", fieldRel.gapAvg5] as const,
                ["Avg top 10", lo.avgTop10, "sec", fieldRel.gapAvg10] as const,
                ["Avg top 15", lo.avgTop15, "sec", fieldRel.gapAvg15] as const,
                ["Consistency", lo.consistencyScore, "score", null] as const,
              ] as const
            ).map(([label, m, kind, fieldGap]) => (
              <div
                key={`${label}-m`}
                className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[10px]"
              >
                <span className="font-medium text-foreground/85">{label}</span>
                <div className="ml-auto min-w-0 text-right font-mono text-[10px] space-y-0.5">
                  <div className="flex justify-end gap-x-4">
                    <span className="text-muted-foreground font-sans text-[9px] w-12 text-left shrink-0">Value</span>
                    <span className="tabular-nums">
                      {kind === "sec"
                        ? fmtSec(m.current, m.notMeaningful)
                        : m.current != null
                          ? formatConsistencyScorePercent(m.current)
                          : "—"}
                    </span>
                  </div>
                  <div className="flex justify-end gap-x-4">
                    <span className="text-muted-foreground font-sans text-[9px] w-12 text-left shrink-0">Δ ref</span>
                    <span className="tabular-nums text-muted-foreground">
                      {kind === "sec" ? fmtDeltaSec(m.delta) : fmtDeltaScore(m.delta)}
                    </span>
                  </div>
                  {fieldRel.showVsFieldColumn ? (
                    <div className="flex justify-end gap-x-4">
                      <span className="text-muted-foreground font-sans text-[9px] w-12 text-left shrink-0">Vs field</span>
                      <span className="tabular-nums text-muted-foreground">
                        {fieldGap != null ? fmtDeltaSec(fieldGap) : "—"}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex justify-end gap-x-4 items-center">
                    <span className="text-muted-foreground font-sans text-[9px] w-12 text-left shrink-0">Flag</span>
                    <span className={cn(flagClass(m.flag))}>{m.flag}</span>
                  </div>
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
                  <th className="py-1.5 px-2 font-medium" title="vs your reference run">
                    Δ ref
                  </th>
                  {fieldRel.showVsFieldColumn ? (
                    <th
                      className="py-1.5 px-2 font-medium"
                      title={
                        fieldRel.vsFieldUsesSessionMeans
                          ? "Gap vs session field average (imported timing)"
                          : "Gap vs session-best competitor (imported timing)"
                      }
                    >
                      Vs field
                    </th>
                  ) : null}
                  <th className="py-1.5 px-2 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody className="font-mono text-foreground/90">
                {(
                  [
                    ["Best", lo.best, "sec", fieldRel.gapBest] as const,
                    ["Avg top 5", lo.avgTop5, "sec", fieldRel.gapAvg5] as const,
                    ["Avg top 10", lo.avgTop10, "sec", fieldRel.gapAvg10] as const,
                    ["Avg top 15", lo.avgTop15, "sec", fieldRel.gapAvg15] as const,
                    ["Consistency", lo.consistencyScore, "score", null] as const,
                  ] as const
                ).map(([label, m, kind, fieldGap]) => (
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
                    {fieldRel.showVsFieldColumn ? (
                      <td className="py-1 px-2 tabular-nums text-muted-foreground">
                        {fieldGap != null ? fmtDeltaSec(fieldGap) : "—"}
                      </td>
                    ) : null}
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
        </div>
      ) : null}
    </div>
  );
}
