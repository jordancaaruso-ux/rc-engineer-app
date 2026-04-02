"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { getActiveSetupData } from "@/lib/activeSetupContext";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { formatRunPickerLineRelativeWhen } from "@/lib/runPickerFormat";
import { compareSetupSnapshots } from "@/lib/setupCompare/compare";

type DownloadedSetupOption = {
  id: string;
  originalFilename: string;
  createdAt: string;
  setupData: unknown;
};

type SetupSourceKind = "none" | "current_setup" | "run" | "downloaded_setup";

type SelectedSetup = {
  kind: SetupSourceKind;
  label: string;
  data: SetupSnapshotData | null;
};

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
  const [runs, setRuns] = useState<RunPickerRun[]>([]);
  const [downloaded, setDownloaded] = useState<DownloadedSetupOption[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [aKind, setAKind] = useState<SetupSourceKind>("none");
  const [bKind, setBKind] = useState<SetupSourceKind>("none");
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");

  useEffect(() => {
    if (!dbReady) return;
    let alive = true;
    setErr(null);
    Promise.all([
      jsonFetch<{ runs: RunPickerRun[] }>("/api/runs/for-picker").catch(() => ({ runs: [] })),
      jsonFetch<{ downloadedSetups: DownloadedSetupOption[] }>("/api/setup/options").catch(() => ({ downloadedSetups: [] })),
    ])
      .then(([r, d]) => {
        if (!alive) return;
        setRuns(Array.isArray(r.runs) ? r.runs : []);
        setDownloaded(Array.isArray(d.downloadedSetups) ? d.downloadedSetups : []);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Failed to load setup sources");
      });
    return () => {
      alive = false;
    };
  }, [dbReady]);

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
  const compareMap = useMemo(() => {
    if (!canCompare || !selectionA.data || !selectionB.data) return null;
    return compareSetupSnapshots(selectionA.data, selectionB.data);
  }, [canCompare, selectionA.data, selectionB.data]);

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
          <Link href="/setup" className="text-xs text-muted-foreground hover:text-foreground">
            Back to Setup
          </Link>
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

        {compareMap ? (
          <div className="text-[11px] text-muted-foreground">
            Same: {severityCounts.same} · Minor: {severityCounts.minor} · Moderate: {severityCounts.moderate} · Major: {severityCounts.major} · Unknown: {severityCounts.unknown}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">Select both setups to compare.</div>
        )}
      </div>

      {canCompare && selectionA.data && selectionB.data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Setup A</div>
            <SetupSheetView value={selectionA.data} onChange={() => {}} readOnly template={A800RR_SETUP_SHEET_V1} baselineValue={selectionB.data} />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Setup B</div>
            <SetupSheetView value={selectionB.data} onChange={() => {}} readOnly template={A800RR_SETUP_SHEET_V1} baselineValue={selectionA.data} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

