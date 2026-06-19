"use client";

import { useCallback, useEffect, useState } from "react";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { CardPanel } from "@/components/ui/CardPanel";

const quickAskBtnClass =
  "inline-flex items-center rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/60 transition disabled:opacity-40 disabled:cursor-not-allowed";

export function EngineerRunSummaryPanel({
  runId,
  compareRunId,
  defaultExpanded = true,
  onCompareSetupsWithEngineer,
  onCompareLaptimesWithEngineer,
}: {
  runId: string;
  /** When set, summary compares this run to `compareRunId` (teammate allowed if linked). */
  compareRunId?: string | null;
  /** Collapse details for dense layouts */
  defaultExpanded?: boolean;
  /** Legacy: single “compare setups” action. */
  onCompareSetupsWithEngineer?: () => void;
  /** Legacy: single “compare lap times” action. */
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
      <CardPanel>
        <p className="text-[11px] text-muted-foreground">Loading engineer summary…</p>
      </CardPanel>
    );
  }
  if (err) {
    return (
      <CardPanel className="border-destructive/30">
        <p className="text-[11px] text-destructive">{err}</p>
      </CardPanel>
    );
  }
  if (!summary) return null;

  const hasCompareInUrl = Boolean(compareRunId?.trim());

  const showFullBody = defaultExpanded || fullSummaryOpen;

  return (
    <CardPanel contentClassName="p-0">
      <div className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <div className="ui-title text-[10px] text-muted-foreground">Engineer summary</div>
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
          {onCompareSetupsWithEngineer || onCompareLaptimesWithEngineer ? (
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

          <div className="text-muted-foreground">
            Included laps: <span className="text-foreground/90 font-mono">{summary.lapCountIncluded.current}</span>
            {summary.lapCountIncluded.reference != null ? (
              <>
                {" "}
                {hasCompareInUrl ? "vs cmp " : "vs ref "}
                <span className="text-foreground/90 font-mono">{summary.lapCountIncluded.reference}</span>
              </>
            ) : null}
          </div>

          {summary.setupChanges.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] ui-title text-muted-foreground">Key setup changes</div>
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

          <CardPanel contentClassName="text-foreground/90">{summary.interpretation}</CardPanel>

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
    </CardPanel>
  );
}
