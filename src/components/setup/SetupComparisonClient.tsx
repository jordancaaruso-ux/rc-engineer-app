"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { getActiveSetupData } from "@/lib/activeSetupContext";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import {
  SETUP_SHEET_TEMPLATE_A800RR,
  canonicalSetupSheetTemplateId,
} from "@/lib/setupSheetTemplateId";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLineRelativeWhen } from "@/lib/runPickerFormat";
import { compareSetupSnapshots } from "@/lib/setupCompare/compare";
import type { NumericAggregationCompareSlice } from "@/lib/setupCompare/numericAggregationCompare";
import {
  buildNumericAggregationMapFromCommunity,
  COMMUNITY_AGGREGATION_PSEUDO_CAR_ID,
  type SetupAggApiRow,
} from "@/lib/setupCompare/buildNumericAggregationMap";
import {
  buildRawNumericStatsJsonMap,
  collectNumericUnknownDiagnostics,
  listNumericGradientCompareKeys,
  summarizeAggregationRowsForCar,
  tallyPrimaryReasons,
} from "@/lib/setupCompare/compareNumericDiagnostics";
import {
  ALL_GRIP_BUCKETS,
  GRIP_BUCKET_ANY,
  gripBucketLabel,
  type GripBucket,
} from "@/lib/setupAggregations/gripBuckets";

type AggregationFetchBundle = {
  parsedMap: Map<string, NumericAggregationCompareSlice>;
  rawNumericJsonByKey: Map<string, unknown>;
  summaries: ReturnType<typeof summarizeAggregationRowsForCar>;
};

type DownloadedSetupOption = {
  id: string;
  originalFilename: string;
  createdAt: string;
  setupData: unknown;
  /** From `createdSetup.carId` when the document was applied to a car. */
  carId?: string | null;
};

type SetupSourceKind = "none" | "current_setup" | "run" | "downloaded_setup";

type SelectedSetup = {
  kind: SetupSourceKind;
  label: string;
  data: SetupSnapshotData | null;
};

type TrackSurface = "asphalt" | "carpet";

async function jsonFetch<T>(input: string): Promise<T> {
  const res = await fetch(input);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
  return data as T;
}

function emptySelection(): SelectedSetup {
  return { kind: "none", label: "—", data: null };
}

export function SetupComparisonClient({ dbReady }: { dbReady: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const compareDebug = searchParams.get("compareDebug") === "1";

  const [runs, setRuns] = useState<RunPickerRun[]>([]);
  const [downloaded, setDownloaded] = useState<DownloadedSetupOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sourcesReloading, setSourcesReloading] = useState(false);
  const [sourcesRefreshedAt, setSourcesRefreshedAt] = useState<number | null>(null);

  const [aKind, setAKind] = useState<SetupSourceKind>("none");
  const [bKind, setBKind] = useState<SetupSourceKind>("none");
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");

  const reloadSources = useCallback(async () => {
    if (!dbReady) return;
    setSourcesReloading(true);
    setErr(null);
    try {
      const [r, d] = await Promise.all([
        jsonFetch<{ runs: RunPickerRun[] }>("/api/runs/for-picker").catch(() => ({ runs: [] })),
        jsonFetch<{ downloadedSetups: DownloadedSetupOption[] }>("/api/setup/options").catch(() => ({ downloadedSetups: [] })),
      ]);
      setRuns(Array.isArray(r.runs) ? r.runs : []);
      setDownloaded(Array.isArray(d.downloadedSetups) ? d.downloadedSetups : []);
      setSourcesRefreshedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load setup sources");
    } finally {
      setSourcesReloading(false);
    }
  }, [dbReady]);

  // Initial load + refetch when the tab regains focus / becomes visible, so freshly downloaded
  // setups show up without a manual refresh.
  useEffect(() => {
    if (!dbReady) return;
    void reloadSources();
    const onFocus = () => {
      void reloadSources();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void reloadSources();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [dbReady, reloadSources]);

  const selectionA: SelectedSetup = useMemo(() => {
    if (aKind === "current_setup") {
      const cur = normalizeSetupData(getActiveSetupData() ?? {});
      return { kind: aKind, label: "Current setup", data: cur };
    }
    if (aKind === "run") {
      const r = runs.find((x) => x.id === aId);
      return r
        ? { kind: aKind, label: formatRunPickerLineRelativeWhen(r), data: normalizeSetupData(r.setupSnapshot?.data ?? {}) }
        : emptySelection();
    }
    if (aKind === "downloaded_setup") {
      const d = downloaded.find((x) => x.id === aId);
      return d
        ? { kind: aKind, label: `${d.originalFilename} · ${new Date(d.createdAt).toLocaleDateString()}`, data: normalizeSetupData(d.setupData ?? {}) }
        : emptySelection();
    }
    return emptySelection();
  }, [aKind, aId, runs, downloaded]);

  const selectionB: SelectedSetup = useMemo(() => {
    if (bKind === "current_setup") {
      const cur = normalizeSetupData(getActiveSetupData() ?? {});
      return { kind: bKind, label: "Current setup", data: cur };
    }
    if (bKind === "run") {
      const r = runs.find((x) => x.id === bId);
      return r
        ? { kind: bKind, label: formatRunPickerLineRelativeWhen(r), data: normalizeSetupData(r.setupSnapshot?.data ?? {}) }
        : emptySelection();
    }
    if (bKind === "downloaded_setup") {
      const d = downloaded.find((x) => x.id === bId);
      return d
        ? { kind: bKind, label: `${d.originalFilename} · ${new Date(d.createdAt).toLocaleDateString()}`, data: normalizeSetupData(d.setupData ?? {}) }
        : emptySelection();
    }
    return emptySelection();
  }, [bKind, bId, runs, downloaded]);

  const canCompare = Boolean(selectionA.data && selectionB.data);

  // Engineer-compare button is only meaningful when both selections are saved runs — the Engineer
  // backend resolves the pair from runId + compareRunId URL params today. If either side is the
  // in-memory "Current setup" or a downloaded setup document, we disable it with a tooltip.
  const engineerCompareState = useMemo<{
    enabled: boolean;
    reason: string | null;
    runIdA: string | null;
    runIdB: string | null;
  }>(() => {
    if (!canCompare) return { enabled: false, reason: "Pick both setups first.", runIdA: null, runIdB: null };
    if (aKind !== "run" || bKind !== "run") {
      return {
        enabled: false,
        reason: "Both setups need to be saved runs to use Engineer compare.",
        runIdA: null,
        runIdB: null,
      };
    }
    const runA = runs.find((r) => r.id === aId) ?? null;
    const runB = runs.find((r) => r.id === bId) ?? null;
    if (!runA || !runB) return { enabled: false, reason: "Run not found.", runIdA: null, runIdB: null };
    if (runA.id === runB.id) {
      return { enabled: false, reason: "Pick two different runs.", runIdA: null, runIdB: null };
    }
    if (runA.carId && runB.carId && runA.carId !== runB.carId) {
      return {
        enabled: false,
        reason: "Runs are on different cars — Engineer setup-compare needs the same car.",
        runIdA: runA.id,
        runIdB: runB.id,
      };
    }
    return { enabled: true, reason: null, runIdA: runA.id, runIdB: runB.id };
  }, [canCompare, aKind, bKind, aId, bId, runs]);

  const openEngineerCompare = useCallback(() => {
    if (!engineerCompareState.enabled || !engineerCompareState.runIdA || !engineerCompareState.runIdB) {
      return;
    }
    const params = new URLSearchParams();
    params.set("runId", engineerCompareState.runIdA);
    params.set("compareRunId", engineerCompareState.runIdB);
    params.set("engineerPrompt", "compare_setups");
    router.push(`/engineer?${params.toString()}`);
  }, [engineerCompareState, router]);

  /** Community IQR uses the same (template, surface, grip) buckets as `CommunitySetupParameterAggregation`. */
  const communityTemplateKey = useMemo(() => {
    if (aKind !== "run" || bKind !== "run" || !aId || !bId) {
      return SETUP_SHEET_TEMPLATE_A800RR;
    }
    const runA = runs.find((r) => r.id === aId) ?? null;
    const runB = runs.find((r) => r.id === bId) ?? null;
    if (!runA || !runB) return SETUP_SHEET_TEMPLATE_A800RR;
    const tA = canonicalSetupSheetTemplateId(runA.car?.setupSheetTemplate ?? null);
    const tB = canonicalSetupSheetTemplateId(runB.car?.setupSheetTemplate ?? null);
    if (tA && tB && tA !== tB) return null;
    return tA ?? tB ?? SETUP_SHEET_TEMPLATE_A800RR;
  }, [aKind, bKind, aId, bId, runs]);
  const [trackSurface, setTrackSurface] = useState<TrackSurface>("asphalt");
  const [gripLevel, setGripLevel] = useState<GripBucket>(GRIP_BUCKET_ANY);

  const [aggregationBundle, setAggregationBundle] = useState<AggregationFetchBundle | null>(null);

  useEffect(() => {
    if (!dbReady || communityTemplateKey == null) {
      setAggregationBundle(null);
      return;
    }
    let alive = true;
    const q = new URLSearchParams({
      setupSheetTemplate: communityTemplateKey,
      trackSurface,
      gripLevel,
    }).toString();
    fetch(`/api/setup-aggregations/community?${q}`)
      .then((res) => res.json())
      .then((data: { aggregations?: SetupAggApiRow[] }) => {
        if (!alive) return;
        const rows = Array.isArray(data.aggregations) ? data.aggregations : [];
        setAggregationBundle({
          parsedMap: buildNumericAggregationMapFromCommunity(rows),
          rawNumericJsonByKey: buildRawNumericStatsJsonMap(rows, COMMUNITY_AGGREGATION_PSEUDO_CAR_ID),
          summaries: summarizeAggregationRowsForCar(rows, COMMUNITY_AGGREGATION_PSEUDO_CAR_ID),
        });
      })
      .catch(() => {
        if (alive) setAggregationBundle(null);
      });
    return () => {
      alive = false;
    };
  }, [dbReady, communityTemplateKey, trackSurface, gripLevel]);

  const numericAggregationByKey = aggregationBundle?.parsedMap ?? null;
  const communitySampleCount = useMemo(() => {
    if (!aggregationBundle) return 0;
    let max = 0;
    for (const s of aggregationBundle.summaries) {
      if (s.sampleCount > max) max = s.sampleCount;
    }
    return max;
  }, [aggregationBundle]);

  const compareMap = useMemo(() => {
    if (!canCompare || !selectionA.data || !selectionB.data) return null;
    return compareSetupSnapshots(selectionA.data, selectionB.data, {
      numericAggregationByKey,
    });
  }, [canCompare, selectionA.data, selectionB.data, numericAggregationByKey]);

  const gradientCompareKeys = useMemo(() => [...listNumericGradientCompareKeys()].sort(), []);

  const numericAggregationParameterKeys = useMemo(() => {
    if (!aggregationBundle) return [];
    return aggregationBundle.summaries
      .filter((s) => s.valueType === "NUMERIC")
      .map((s) => s.parameterKey)
      .sort();
  }, [aggregationBundle]);

  const numericUnknownDiagnostics = useMemo(() => {
    if (
      !compareDebug ||
      !compareMap ||
      !selectionA.data ||
      !selectionB.data
    ) {
      return [];
    }
    return collectNumericUnknownDiagnostics({
      compareMap,
      dataA: selectionA.data as Record<string, unknown>,
      dataB: selectionB.data as Record<string, unknown>,
      numericAggregationByKey,
      rawNumericStatsJsonByKey: aggregationBundle?.rawNumericJsonByKey ?? null,
      aggregationSummariesForCar: aggregationBundle?.summaries ?? [],
      aggregationCarId: COMMUNITY_AGGREGATION_PSEUDO_CAR_ID,
    });
  }, [
    compareDebug,
    compareMap,
    selectionA.data,
    selectionB.data,
    numericAggregationByKey,
    aggregationBundle?.rawNumericJsonByKey,
    aggregationBundle?.summaries,
  ]);

  const diagnosticReasonTally = useMemo(
    () => [...tallyPrimaryReasons(numericUnknownDiagnostics).entries()].sort((a, b) => b[1] - a[1]),
    [numericUnknownDiagnostics]
  );

  const topDiagnosticReason = diagnosticReasonTally[0]?.[0] ?? null;

  const severityCounts = useMemo(() => {
    const counts = { same: 0, minor: 0, moderate: 0, major: 0, unknown: 0 };
    if (!compareMap) return counts;
    for (const r of compareMap.values()) counts[r.severity]++;
    return counts;
  }, [compareMap]);

  return (
    <div className="space-y-4">
      {!dbReady ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Database not configured — only “Current setup” can be compared.
        </div>
      ) : null}

      {err ? <div className="rounded-md border border-border bg-destructive/10 p-3 text-xs">{err}</div> : null}

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="ui-title text-sm text-muted-foreground">Pick two setups</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openEngineerCompare}
              disabled={!engineerCompareState.enabled}
              className="rounded-md border border-primary/60 bg-primary/90 px-2 py-1 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary disabled:cursor-default disabled:opacity-40"
              title={
                engineerCompareState.reason ??
                "Open the Engineer chat with these two runs and auto-run the compare-setups prompt"
              }
            >
              Use Engineer to compare
            </button>
            <button
              type="button"
              onClick={() => void reloadSources()}
              disabled={!dbReady || sourcesReloading}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:cursor-default disabled:opacity-50"
              title={
                sourcesRefreshedAt
                  ? `Last refreshed ${new Date(sourcesRefreshedAt).toLocaleTimeString()}`
                  : "Reload run and downloaded setup lists"
              }
            >
              {sourcesReloading ? "Refreshing…" : "Refresh sources"}
            </button>
            <Link href="/setup" className="text-xs text-muted-foreground hover:text-foreground">
              Back to Setup
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Setup A</div>
            <select className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs" value={aKind} onChange={(e) => { setAKind(e.target.value as SetupSourceKind); setAId(""); }}>
              <option value="none">Select source…</option>
              <option value="current_setup">Current setup</option>
              <option value="run">Run setup</option>
              <option value="downloaded_setup">Downloaded setup</option>
            </select>
            {aKind === "run" ? (
              <select className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs font-mono" value={aId} onChange={(e) => setAId(e.target.value)}>
                <option value="">Choose run…</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>{formatRunPickerLineRelativeWhen(r)}</option>
                ))}
              </select>
            ) : null}
            {aKind === "downloaded_setup" ? (
              <select className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs font-mono" value={aId} onChange={(e) => setAId(e.target.value)}>
                <option value="">Choose setup…</option>
                {downloaded.map((d) => (
                  <option key={d.id} value={d.id}>{`${d.originalFilename} · ${new Date(d.createdAt).toLocaleDateString()}`}</option>
                ))}
              </select>
            ) : null}
            <div className="text-[11px] text-muted-foreground break-words">{selectionA.label}</div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Setup B</div>
            <select className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs" value={bKind} onChange={(e) => { setBKind(e.target.value as SetupSourceKind); setBId(""); }}>
              <option value="none">Select source…</option>
              <option value="current_setup">Current setup</option>
              <option value="run">Run setup</option>
              <option value="downloaded_setup">Downloaded setup</option>
            </select>
            {bKind === "run" ? (
              <select className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs font-mono" value={bId} onChange={(e) => setBId(e.target.value)}>
                <option value="">Choose run…</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>{formatRunPickerLineRelativeWhen(r)}</option>
                ))}
              </select>
            ) : null}
            {bKind === "downloaded_setup" ? (
              <select className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs font-mono" value={bId} onChange={(e) => setBId(e.target.value)}>
                <option value="">Choose setup…</option>
                {downloaded.map((d) => (
                  <option key={d.id} value={d.id}>{`${d.originalFilename} · ${new Date(d.createdAt).toLocaleDateString()}`}</option>
                ))}
              </select>
            ) : null}
            <div className="text-[11px] text-muted-foreground break-words">{selectionB.label}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Spread source · surface</div>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs"
              value={trackSurface}
              onChange={(e) => setTrackSurface(e.target.value as TrackSurface)}
            >
              <option value="asphalt">Asphalt</option>
              <option value="carpet">Carpet</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Spread source · grip</div>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs"
              value={gripLevel}
              onChange={(e) => setGripLevel(e.target.value as GripBucket)}
            >
              {ALL_GRIP_BUCKETS.map((g) => (
                <option key={g} value={g}>{gripBucketLabel(g)}</option>
              ))}
            </select>
          </div>
        </div>

        {compareMap ? (
          <div className="text-[11px] text-muted-foreground space-y-1">
            <div>
              Same: {severityCounts.same} · Minor: {severityCounts.minor} · Moderate: {severityCounts.moderate} · Major:{" "}
              {severityCounts.major} · Unknown: {severityCounts.unknown}
            </div>
            <div>
              Spread scale from all eligible setups in the community (template{" "}
              <span className="text-foreground/80">
                {communityTemplateKey ?? "mixed — community IQR off"}
              </span>{" "}
              · {trackSurface} · {gripBucketLabel(gripLevel)}
              {communitySampleCount > 0 ? ` · ~${communitySampleCount} docs in bucket` : " · no docs in bucket yet"}
              ). Fields without enough community samples fall back to low-confidence grey.
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">Select both setups to compare.</div>
        )}
      </div>

      {compareDebug && canCompare && selectionA.data && selectionB.data ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-xs space-y-3 font-mono">
          <div className="text-[11px] font-sans font-medium text-foreground">
            Temporary diagnostics <span className="text-muted-foreground">(?compareDebug=1)</span>
          </div>
          <div className="text-muted-foreground font-sans">
            IQR compare keys ({gradientCompareKeys.length}):{" "}
            <span className="text-foreground/90 break-all">{gradientCompareKeys.join(", ")}</span>
          </div>
          <div className="text-muted-foreground font-sans">
            NUMERIC aggregation keys in community bucket{" "}
            <span className="text-foreground/90">
              {communityTemplateKey ?? "mixed (off)"} · {trackSurface} · {gripBucketLabel(gripLevel)}
            </span>{" "}
            ({numericAggregationParameterKeys.length}):{" "}
            <span className="text-foreground/90 break-all">{numericAggregationParameterKeys.join(", ") || "—"}</span>
          </div>
          <div className="text-muted-foreground font-sans">
            Most common unknown reason:{" "}
            <span className="text-foreground/90">{topDiagnosticReason ?? "—"}</span>
            {diagnosticReasonTally.length ? (
              <pre className="mt-2 max-h-40 overflow-auto rounded border border-border bg-card p-2 text-[10px] whitespace-pre-wrap">
                {diagnosticReasonTally.map(([k, n]) => `${n}\t${k}`).join("\n")}
              </pre>
            ) : null}
          </div>
          {numericUnknownDiagnostics.length ? (
            <div className="overflow-x-auto rounded border border-border bg-card">
              <table className="w-full min-w-[720px] border-collapse text-left text-[10px]">
                <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-1.5">uiKey</th>
                    <th className="p-1.5">matchedAggKey</th>
                    <th className="p-1.5">rows</th>
                    <th className="p-1.5">aggType</th>
                    <th className="p-1.5">rawN</th>
                    <th className="p-1.5">inMap</th>
                    <th className="p-1.5">parseOk</th>
                    <th className="p-1.5">p25</th>
                    <th className="p-1.5">p75</th>
                    <th className="p-1.5">iqr</th>
                    <th className="p-1.5">Δ</th>
                    <th className="p-1.5">primaryReason</th>
                  </tr>
                </thead>
                <tbody>
                  {numericUnknownDiagnostics.map((d) => (
                    <tr key={d.uiKey} className="border-b border-border/60 align-top">
                      <td className="p-1.5">{d.uiKey}</td>
                      <td className="p-1.5">{d.matchedAggregationKey ?? "null"}</td>
                      <td className="p-1.5">{d.aggregationRowsForExactKey}</td>
                      <td className="p-1.5">{d.aggregationValueType ?? "—"}</td>
                      <td className="p-1.5">{d.rawJsonSampleCount ?? "—"}</td>
                      <td className="p-1.5">{d.inClientCompareMap ? "y" : "n"}</td>
                      <td className="p-1.5">{d.rawJsonParsesToPercentileSlice ? "y" : "n"}</td>
                      <td className="p-1.5">{d.p25 ?? "—"}</td>
                      <td className="p-1.5">{d.p75 ?? "—"}</td>
                      <td className="p-1.5">{d.iqr ?? "—"}</td>
                      <td className="p-1.5">{d.deltaAbs ?? "—"}</td>
                      <td className="p-1.5 whitespace-pre-wrap break-all">{d.primaryReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-muted-foreground font-sans">No unknown IQR-scored fields in this compare.</div>
          )}
        </div>
      ) : null}

      {canCompare && selectionA.data && selectionB.data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Setup A</div>
            <SetupSheetView
              value={selectionA.data}
              onChange={() => {}}
              readOnly
              template={A800RR_SETUP_SHEET_V1}
              baselineValue={selectionB.data}
              numericAggregationByKey={numericAggregationByKey}
              compareValueColumnRole="a"
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Setup B</div>
            <SetupSheetView
              value={selectionB.data}
              onChange={() => {}}
              readOnly
              template={A800RR_SETUP_SHEET_V1}
              baselineValue={selectionA.data}
              numericAggregationByKey={numericAggregationByKey}
              compareValueColumnRole="b"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

