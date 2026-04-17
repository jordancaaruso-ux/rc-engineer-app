"use client";

import { useEffect, useMemo, useState } from "react";

type GripBucket = "any" | "low" | "medium" | "high";

type GripStats = {
  sampleCount: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  p25: number | null;
  p75: number | null;
};

type ApiResponse = {
  setupSheetTemplate: string;
  trackSurface: "asphalt" | "carpet";
  bucketMeta: Array<{ gripLevel: GripBucket; maxSampleCount: number; parameterCount: number }>;
  parameters: Array<{
    parameterKey: string;
    per: Record<GripBucket, GripStats | null>;
  }>;
};

type Props = {
  carId: string;
  carName: string;
  setupSheetTemplate: string;
  defaultSurface: "asphalt" | "carpet";
  yourSetup: Record<string, string | number>;
  latestRun: { runId: string; createdAtIso: string } | null;
};

type SortKey = "param" | "any" | "low" | "medium" | "high" | "lowMedDelta" | "medHighDelta";

const GRIP_COLUMNS: Array<{ key: GripBucket; label: string }> = [
  { key: "low", label: "Low grip" },
  { key: "medium", label: "Medium grip" },
  { key: "high", label: "High grip" },
  { key: "any", label: "Any grip" },
];

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(digits);
}

function fmtRange(s: GripStats | null): string {
  if (!s) return "—";
  if (s.min == null || s.max == null) return "—";
  return `${fmtNum(s.min)} – ${fmtNum(s.max)}`;
}

function bucketCell(stats: GripStats | null): string {
  if (!stats) return "—";
  const median = fmtNum(stats.median);
  return `${median}  (n=${stats.sampleCount})`;
}

function parseYourValue(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().replace(/,/g, ".");
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function GripArchetypesClient(props: Props) {
  const { carId, setupSheetTemplate, defaultSurface, yourSetup, latestRun } = props;
  const [surface, setSurface] = useState<"asphalt" | "carpet">(defaultSurface);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("param");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [onlyWithYours, setOnlyWithYours] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ carId, surface });
        const res = await fetch(`/api/setup-aggregations/grip-archetypes?${params.toString()}`);
        const json = (await res.json()) as ApiResponse | { error?: string };
        if (cancelled) return;
        if (!res.ok || "error" in json) {
          setError((json as { error?: string }).error ?? "Failed to load archetypes.");
          setData(null);
        } else {
          setData(json as ApiResponse);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load archetypes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [carId, surface]);

  const rowsForDisplay = useMemo(() => {
    if (!data) return [] as ApiResponse["parameters"];
    let rows = data.parameters;
    if (onlyWithYours) {
      rows = rows.filter((r) => yourSetup[r.parameterKey] != null);
    }
    const withSortKeys = rows.map((r) => {
      const lowMed =
        r.per.low && r.per.medium && r.per.low.median != null && r.per.medium.median != null
          ? r.per.medium.median - r.per.low.median
          : null;
      const medHigh =
        r.per.medium && r.per.high && r.per.medium.median != null && r.per.high.median != null
          ? r.per.high.median - r.per.medium.median
          : null;
      return { row: r, lowMed, medHigh };
    });
    withSortKeys.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "param") {
        return a.row.parameterKey.localeCompare(b.row.parameterKey) * dir;
      }
      if (sortKey === "lowMedDelta") {
        const av = a.lowMed ?? Number.NEGATIVE_INFINITY;
        const bv = b.lowMed ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortKey === "medHighDelta") {
        const av = a.medHigh ?? Number.NEGATIVE_INFINITY;
        const bv = b.medHigh ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      const av = a.row.per[sortKey]?.median ?? Number.NEGATIVE_INFINITY;
      const bv = b.row.per[sortKey]?.median ?? Number.NEGATIVE_INFINITY;
      return (av - bv) * dir;
    });
    return withSortKeys.map((w) => w.row);
  }, [data, onlyWithYours, sortKey, sortDir, yourSetup]);

  function clickSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "param" ? "asc" : "desc");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground space-y-2">
        <p>
          Median tuning values from all community-eligible uploads that match{" "}
          <span className="font-mono">{setupSheetTemplate}</span> on the selected surface, split by the{" "}
          <strong>traction</strong> tag on each doc. A doc tagged <em>low, medium</em> contributes to both Low and Medium
          columns. Rows fall back transparently to the &quot;Any grip&quot; column when a grip bucket has fewer than 10
          samples for a parameter.
        </p>
        {latestRun ? (
          <p className="text-xs">
            &quot;Your value&quot; = your most recent run setup on this car (run{" "}
            <span className="font-mono">{latestRun.runId.slice(0, 8)}</span>).
          </p>
        ) : (
          <p className="text-xs">No logged run with a setup on this car yet — the &quot;your value&quot; column will be empty.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(["asphalt", "carpet"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSurface(s)}
              className={`px-3 py-1.5 ${
                surface === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground hover:bg-muted"
              }`}
            >
              {s[0]?.toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlyWithYours}
            onChange={(e) => setOnlyWithYours(e.target.checked)}
          />
          Only rows where I have a value
        </label>
        {data ? (
          <span className="ml-auto text-muted-foreground">
            {data.bucketMeta
              .filter((b) => b.maxSampleCount > 0)
              .map((b) => `${b.gripLevel}: ≤${b.maxSampleCount} docs`)
              .join(" · ")}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !data || data.parameters.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No numeric parameters have grip-specific samples for this surface yet. Tag more uploads with a traction level and rebuild aggregations.
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th
                  className="px-2 py-2 text-left cursor-pointer"
                  onClick={() => clickSort("param")}
                >
                  Parameter {sortKey === "param" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-right">Your value</th>
                {GRIP_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className="px-2 py-2 text-right cursor-pointer whitespace-nowrap"
                    onClick={() => clickSort(c.key)}
                  >
                    {c.label} {sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </th>
                ))}
                <th
                  className="px-2 py-2 text-right cursor-pointer whitespace-nowrap"
                  onClick={() => clickSort("lowMedDelta")}
                  title="Medium median minus Low median"
                >
                  Δ L→M {sortKey === "lowMedDelta" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  className="px-2 py-2 text-right cursor-pointer whitespace-nowrap"
                  onClick={() => clickSort("medHighDelta")}
                  title="High median minus Medium median"
                >
                  Δ M→H {sortKey === "medHighDelta" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {rowsForDisplay.map((row) => {
                const yourRaw = yourSetup[row.parameterKey];
                const yourNum = parseYourValue(yourRaw);
                const lowMed =
                  row.per.low?.median != null && row.per.medium?.median != null
                    ? row.per.medium.median - row.per.low.median
                    : null;
                const medHigh =
                  row.per.medium?.median != null && row.per.high?.median != null
                    ? row.per.high.median - row.per.medium.median
                    : null;
                return (
                  <tr
                    key={row.parameterKey}
                    className="border-t border-border/60 hover:bg-muted/40"
                  >
                    <td className="px-2 py-1.5 font-mono">{row.parameterKey}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {yourRaw == null
                        ? "—"
                        : yourNum != null
                          ? fmtNum(yourNum)
                          : String(yourRaw)}
                    </td>
                    {GRIP_COLUMNS.map((c) => {
                      const stats = row.per[c.key];
                      return (
                        <td
                          key={c.key}
                          className="px-2 py-1.5 text-right font-mono tabular-nums"
                          title={fmtRange(stats)}
                        >
                          {bucketCell(stats)}
                        </td>
                      );
                    })}
                    <td
                      className={`px-2 py-1.5 text-right font-mono tabular-nums ${
                        lowMed != null && lowMed !== 0
                          ? lowMed > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-orange-600 dark:text-orange-400"
                          : ""
                      }`}
                    >
                      {lowMed == null ? "—" : (lowMed > 0 ? "+" : "") + fmtNum(lowMed)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right font-mono tabular-nums ${
                        medHigh != null && medHigh !== 0
                          ? medHigh > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-orange-600 dark:text-orange-400"
                          : ""
                      }`}
                    >
                      {medHigh == null ? "—" : (medHigh > 0 ? "+" : "") + fmtNum(medHigh)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
