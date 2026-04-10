"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineerDeepDiveAnswersV1, EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

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
  return `${sign}${v.toFixed(0)}`;
}

function flagClass(flag: string): string {
  if (flag === "improved") return "text-emerald-600 dark:text-emerald-400";
  if (flag === "regressed") return "text-rose-600 dark:text-rose-400";
  if (flag === "flat") return "text-muted-foreground";
  return "text-muted-foreground";
}

export function EngineerRunSummaryPanel({
  runId,
  defaultExpanded = true,
}: {
  runId: string;
  /** Collapse details for dense layouts */
  defaultExpanded?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<EngineerRunSummaryV2 | null>(null);
  const [cached, setCached] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [deepDive, setDeepDive] = useState<EngineerDeepDiveAnswersV1 | null>(null);
  const [savingDive, setSavingDive] = useState(false);

  const [dominantIssue, setDominantIssue] = useState("entry");
  const [severityFeel, setSeverityFeel] = useState<"mild" | "moderate" | "severe">("mild");
  const [feelVsPrior, setFeelVsPrior] = useState("unsure");
  const [freeText, setFreeText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/engineer-summary`, { cache: "no-store" });
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
  }, [runId]);

  const loadDeepDive = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/engineer-deep-dive`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const d = (data as { deepDive?: EngineerDeepDiveAnswersV1 | null }).deepDive;
      setDeepDive(d && typeof d === "object" && d.version === 1 ? d : null);
    } catch {
      setDeepDive(null);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadDeepDive();
  }, [loadDeepDive]);

  async function saveDeepDive() {
    setSavingDive(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/engineer-deep-dive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dominantIssue,
          severityFeel,
          feelVsPrior,
          freeText: freeText.trim() || undefined,
          referenceRunId: summary?.referenceRunId ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && typeof data === "object" && "deepDive" in data) {
        setDeepDive((data as { deepDive: EngineerDeepDiveAnswersV1 }).deepDive);
      }
    } finally {
      setSavingDive(false);
    }
  }

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

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition"
      >
        <div className="ui-title text-[10px] uppercase tracking-wide text-muted-foreground">Engineer summary</div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {cached ? <span>cached</span> : null}
          <span>{expanded ? "▼" : "▶"}</span>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-border px-3 py-3 space-y-3 text-[11px] leading-snug">
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

          <div className="rounded-md border border-border bg-muted/40 overflow-x-auto">
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
                      {kind === "sec" ? fmtSec(m.current, m.notMeaningful) : m.current != null ? m.current.toFixed(0) : "—"}
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

          {summary.deepDiveOffered ? (
            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Handling deep dive (optional)</div>
              {deepDive ? (
                <div className="rounded-md bg-muted/40 p-2 text-muted-foreground space-y-1">
                  <div>
                    Saved: {deepDive.dominantIssue} · {deepDive.severityFeel} · {deepDive.feelVsPrior}
                  </div>
                  {deepDive.freeText ? <div className="text-foreground/90">{deepDive.freeText}</div> : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">A few quick taps — optional.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">Where it shows up</span>
                      <select
                        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                        value={dominantIssue}
                        onChange={(e) => setDominantIssue(e.target.value)}
                      >
                        <option value="push">Push / understeer</option>
                        <option value="entry">Entry</option>
                        <option value="mid">Mid-corner</option>
                        <option value="exit">Exit</option>
                        <option value="high_speed">High speed</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">How much</span>
                      <select
                        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                        value={severityFeel}
                        onChange={(e) => setSeverityFeel(e.target.value as "mild" | "moderate" | "severe")}
                      >
                        <option value="mild">Mild</option>
                        <option value="moderate">Moderate</option>
                        <option value="severe">Severe</option>
                      </select>
                    </label>
                    <label className="space-y-0.5 sm:col-span-2">
                      <span className="text-[10px] text-muted-foreground">Feel vs previous run</span>
                      <select
                        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                        value={feelVsPrior}
                        onChange={(e) => setFeelVsPrior(e.target.value)}
                      >
                        <option value="more_grip">More grip</option>
                        <option value="less_grip">Less grip</option>
                        <option value="more_steering">More steering</option>
                        <option value="less_steering">Less steering</option>
                        <option value="same">Same</option>
                        <option value="unsure">Unsure</option>
                      </select>
                    </label>
                    <label className="space-y-0.5 sm:col-span-2">
                      <span className="text-[10px] text-muted-foreground">Optional detail</span>
                      <input
                        className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                        value={freeText}
                        onChange={(e) => setFreeText(e.target.value)}
                        placeholder="One line (optional)"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={savingDive}
                    onClick={() => void saveDeepDive()}
                    className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {savingDive ? "Saving…" : "Save deep dive"}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
