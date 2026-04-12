"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineerRunSummaryPanel } from "@/components/engineer/EngineerRunSummaryPanel";
import type { EngineerCompareOptionsPayload } from "@/lib/engineerPhase5/engineerCompareOptionsTypes";

function defaultCompareId(
  primaryId: string,
  mine: EngineerCompareOptionsPayload["mine"],
  teammates: EngineerCompareOptionsPayload["teammates"]
): string {
  const nextMine = mine.find((r) => r.runId !== primaryId);
  if (nextMine) return nextMine.runId;
  for (const t of teammates) {
    const hit = t.runs.find((r) => r.runId !== primaryId);
    if (hit) return hit.runId;
  }
  return "";
}

/**
 * Deterministic engineer summary with explicit primary vs compare run selection.
 */
export function EngineerLatestRunSummary() {
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams.get("runId")?.trim() || null;

  const [options, setOptions] = useState<EngineerCompareOptionsPayload | null>(null);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [primaryRunId, setPrimaryRunId] = useState<string>("");
  const [compareRunId, setCompareRunId] = useState<string>("");

  const loadOptions = useCallback(async () => {
    const res = await fetch("/api/engineer/compare-options", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as EngineerCompareOptionsPayload | null;
    if (!res.ok || !data?.mine) return null;
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    const p1 = loadOptions();
    const p2 = runIdFromUrl
      ? Promise.resolve(null as { runId?: string } | null)
      : fetch("/api/engineer/summary", { cache: "no-store" })
          .then((r) => r.json().catch(() => ({})))
          .then((data: { runId?: string | null }) => data);

    void Promise.all([p1, p2]).then(([opts, summary]) => {
      if (!alive) return;
      if (opts) setOptions(opts);
      if (!runIdFromUrl && summary && typeof summary.runId === "string") {
        setLatestRunId(summary.runId);
      }
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [loadOptions, runIdFromUrl]);

  // Initialize primary/compare when options + URL/latest resolve
  useEffect(() => {
    if (!options?.mine.length) {
      if (!loading) {
        setPrimaryRunId("");
        setCompareRunId("");
      }
      return;
    }

    const mine = options.mine;
    const fromUrl = runIdFromUrl && mine.some((r) => r.runId === runIdFromUrl) ? runIdFromUrl : null;
    const fromLatest = latestRunId && mine.some((r) => r.runId === latestRunId) ? latestRunId : null;
    const fallbackPrimary = fromLatest ?? mine[0].runId;

    setPrimaryRunId((prev) => {
      if (fromUrl) return fromUrl;
      if (prev && mine.some((m) => m.runId === prev)) return prev;
      return fallbackPrimary;
    });
  }, [options, runIdFromUrl, latestRunId, loading]);

  useEffect(() => {
    if (!options?.mine.length || !primaryRunId) return;
    setCompareRunId((prev) => {
      if (prev && prev !== primaryRunId) {
        const allowed =
          options.mine.some((r) => r.runId === prev) ||
          options.teammates.some((t) => t.runs.some((r) => r.runId === prev));
        if (allowed) return prev;
      }
      return defaultCompareId(primaryRunId, options.mine, options.teammates);
    });
  }, [options, primaryRunId]);

  const compareChoices = useMemo(() => {
    if (!options) {
      return {
        mine: [] as EngineerCompareOptionsPayload["mine"],
        teammates: [] as EngineerCompareOptionsPayload["teammates"],
      };
    }
    const mineRest = options.mine.filter((r) => r.runId !== primaryRunId);
    const teammates = options.teammates.map((t) => ({
      ...t,
      runs: t.runs.filter((r) => r.runId !== primaryRunId),
    }));
    return { mine: mineRest, teammates };
  }, [options, primaryRunId]);

  const panelRunId = primaryRunId || runIdFromUrl || null;
  const effectiveCompare = compareRunId && compareRunId !== primaryRunId ? compareRunId : null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground tracking-tight">Run summary (compare)</h2>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Choose your run (primary), then a reference run—your other sessions or a linked teammate&apos;s. The summary
        shows lap-time deltas and setup differences vs that reference. Open the Engineer page with{" "}
        <span className="font-mono">?runId=</span> to focus chat on a specific run.
      </p>

      {loading ? (
        <div className="rounded-lg border border-border bg-muted/40 p-6 text-sm text-muted-foreground text-center">
          Loading…
        </div>
      ) : !options?.mine.length ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground text-center">
          No runs yet. Log a run to see your engineer summary here.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="font-medium text-foreground">Primary run (yours)</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
                value={primaryRunId}
                onChange={(e) => {
                  const v = e.target.value;
                  setPrimaryRunId(v);
                  setCompareRunId("");
                }}
              >
                {options.mine.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="font-medium text-foreground">Compare to</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
                value={effectiveCompare ?? ""}
                onChange={(e) => setCompareRunId(e.target.value)}
              >
                <option value="">Previous run on same car (auto)</option>
                {compareChoices.mine.length ? (
                  <optgroup label="My other runs">
                    {compareChoices.mine.map((r) => (
                      <option key={r.runId} value={r.runId}>
                        {r.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {compareChoices.teammates.map((t) =>
                  t.runs.length ? (
                    <optgroup key={t.peerUserId} label={`Teammate: ${t.displayName}`}>
                      {t.runs.map((r) => (
                        <option key={r.runId} value={r.runId}>
                          {r.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null
                )}
              </select>
            </label>
          </div>

          {panelRunId ? (
            <EngineerRunSummaryPanel runId={panelRunId} compareRunId={effectiveCompare} />
          ) : null}
        </>
      )}
    </section>
  );
}
