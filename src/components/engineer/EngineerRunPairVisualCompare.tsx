"use client";

import { useEffect, useMemo, useState } from "react";
import {
  alignLapsByNumber,
  buildComparisonSeries,
  primaryLapRowsFromRun,
  type LapRow,
} from "@/lib/lapAnalysis";
import { compareSetupSnapshots } from "@/lib/setupCompare/compare";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { formatLap } from "@/lib/runLaps";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getDefaultSetupSheetTemplate, type SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { cn } from "@/lib/utils";

export type EngineerByIdsRunRow = {
  id: string;
  createdAt: string;
  sessionCompletedAt: string | null;
  loggingCompletedAt: string | null;
  sortAt: string | null;
  sessionLabel: string | null;
  sessionType: string;
  meetingSessionType: string | null;
  meetingSessionCode: string | null;
  eventId: string | null;
  trackId: string | null;
  carId: string | null;
  carNameSnapshot: string | null;
  trackNameSnapshot: string | null;
  lapTimes: unknown;
  lapSession: unknown;
  setupSnapshot: { id: string; data: unknown } | null;
  car: { name: string; setupSheetTemplate: string | null } | null;
  track: { name: string } | null;
  event: { name: string } | null;
};

function templateForRun(carTemplate: string | null | undefined): SetupSheetTemplate {
  if (isA800RRCar(carTemplate)) return A800RR_SETUP_SHEET_V1;
  return getDefaultSetupSheetTemplate();
}

function changedSetupKeys(a: SetupSnapshotData, b: SetupSnapshotData): Set<string> {
  const cmp = compareSetupSnapshots(a, b);
  const out = new Set<string>();
  for (const [key, row] of cmp) {
    if (row.severity !== "same") out.add(key);
  }
  return out;
}

function LapPairTable({
  runA,
  runB,
  labelA,
  labelB,
}: {
  runA: EngineerByIdsRunRow;
  runB: EngineerByIdsRunRow;
  labelA: string;
  labelB: string;
}) {
  const { nums, byNumA, byNumB } = useMemo(() => {
    const lapsA = primaryLapRowsFromRun({ lapTimes: runA.lapTimes, lapSession: runA.lapSession });
    const lapsB = primaryLapRowsFromRun({ lapTimes: runB.lapTimes, lapSession: runB.lapSession });
    const sA = buildComparisonSeries("a", labelA, "run", lapsA);
    const sB = buildComparisonSeries("b", labelB, "run", lapsB);
    const nums = alignLapsByNumber([sA, sB]);
    const byNumA = new Map<number, LapRow>();
    const byNumB = new Map<number, LapRow>();
    for (const l of lapsA) byNumA.set(l.lapNumber, l);
    for (const l of lapsB) byNumB.set(l.lapNumber, l);
    return { nums, byNumA, byNumB };
  }, [runA, runB, labelA, labelB]);

  if (nums.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground rounded-md border border-border bg-muted/30 px-2 py-2">
        No comparable lap rows on one or both runs (check lap times / session).
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[320px] text-[11px]">
        <thead>
          <tr className="border-b border-border bg-muted/70 text-left text-[10px] font-medium text-muted-foreground">
            <th className="px-2 py-1.5">Lap</th>
            <th className="px-2 py-1.5">{labelA}</th>
            <th className="px-2 py-1.5">{labelB}</th>
            <th className="px-2 py-1.5">Δ (B−A)</th>
          </tr>
        </thead>
        <tbody>
          {nums.map((n) => {
            const a = byNumA.get(n);
            const b = byNumB.get(n);
            const ta =
              a && typeof a.lapTimeSeconds === "number" && Number.isFinite(a.lapTimeSeconds)
                ? a.lapTimeSeconds
                : null;
            const tb =
              b && typeof b.lapTimeSeconds === "number" && Number.isFinite(b.lapTimeSeconds)
                ? b.lapTimeSeconds
                : null;
            const delta = ta != null && tb != null ? tb - ta : null;
            const incNote = (x: LapRow | undefined) =>
              x && !x.isIncluded ? (
                <span className="ml-0.5 text-[9px] text-muted-foreground">ex</span>
              ) : null;
            return (
              <tr key={n} className="border-b border-border/70">
                <td className="px-2 py-1 font-mono tabular-nums">{n}</td>
                <td className="px-2 py-1 font-mono tabular-nums">
                  {ta != null ? formatLap(ta) : "—"}
                  {incNote(a)}
                </td>
                <td className="px-2 py-1 font-mono tabular-nums">
                  {tb != null ? formatLap(tb) : "—"}
                  {incNote(b)}
                </td>
                <td className="px-2 py-1 font-mono tabular-nums text-muted-foreground">
                  {delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EngineerRunPairVisualCompare({
  runIdA,
  runIdB,
  labelA,
  labelB,
  className,
}: {
  runIdA: string;
  runIdB: string;
  /** Short column headers (e.g. digest line or picker label). */
  labelA: string;
  labelB: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<[EngineerByIdsRunRow | null, EngineerByIdsRunRow | null]>([null, null]);

  useEffect(() => {
    const a = runIdA.trim();
    const b = runIdB.trim();
    if (!a || !b) {
      setRuns([null, null]);
      setErr(null);
      return;
    }
    if (a === b) {
      setRuns([null, null]);
      setErr("Pick two different runs.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams();
    qs.set("ids", `${a},${b}`);

    void fetch(`/api/runs/by-ids?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          runs?: EngineerByIdsRunRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setRuns([null, null]);
          setErr(data.error ?? `Could not load runs (${res.status})`);
          return;
        }
        const list = Array.isArray(data.runs) ? data.runs : [];
        const ra = list.find((r) => r.id === a) ?? null;
        const rb = list.find((r) => r.id === b) ?? null;
        if (!ra || !rb) {
          setRuns([null, null]);
          setErr("Could not resolve both runs.");
          return;
        }
        setRuns([ra, rb]);
      })
      .catch(() => {
        if (!cancelled) {
          setRuns([null, null]);
          setErr("Network error loading runs.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runIdA, runIdB]);

  const [runA, runB] = runs;
  const setupA = useMemo(() => normalizeSetupData(runA?.setupSnapshot?.data ?? {}), [runA]);
  const setupB = useMemo(() => normalizeSetupData(runB?.setupSnapshot?.data ?? {}), [runB]);

  const highlightA = useMemo(
    () => (runA && runB ? changedSetupKeys(setupA, setupB) : new Set<string>()),
    [runA, runB, setupA, setupB]
  );
  const highlightB = highlightA;

  const template = useMemo(() => {
    const t = runA?.car?.setupSheetTemplate ?? runB?.car?.setupSheetTemplate;
    return templateForRun(t);
  }, [runA, runB]);

  return (
    <div className={cn("space-y-3", className)}>
      {loading ? <p className="text-[11px] text-muted-foreground">Loading setup and laps…</p> : null}
      {err ? <p className="text-[11px] text-destructive">{err}</p> : null}

      {runA && runB ? (
        <>
          <div>
            <h4 className="ui-title text-[10px] text-muted-foreground mb-1.5">Lap times</h4>
            <LapPairTable runA={runA} runB={runB} labelA={labelA} labelB={labelB} />
          </div>

          <div>
            <h4 className="ui-title text-[10px] text-muted-foreground mb-1.5">Setup (side by side)</h4>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-1 text-[10px] font-medium text-muted-foreground truncate" title={labelA}>
                  {labelA}
                </div>
                <SetupSheetView
                  template={template}
                  value={setupA}
                  onChange={() => {}}
                  readOnly
                  baselineValue={setupB}
                  highlightChangedKeys={highlightA}
                  compareValueColumnRole="a"
                  className="shadow-none"
                />
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-[10px] font-medium text-muted-foreground truncate" title={labelB}>
                  {labelB}
                </div>
                <SetupSheetView
                  template={template}
                  value={setupB}
                  onChange={() => {}}
                  readOnly
                  baselineValue={setupA}
                  highlightChangedKeys={highlightB}
                  compareValueColumnRole="b"
                  className="shadow-none"
                />
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
