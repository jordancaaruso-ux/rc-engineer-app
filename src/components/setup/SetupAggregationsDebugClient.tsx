"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CarRow = { id: string; name: string; chassis: string | null };
type AggRow = {
  carId: string;
  parameterKey: string;
  valueType: string;
  sampleCount: number;
  numericStatsJson: unknown;
  categoricalStatsJson: unknown;
  updatedAt: string;
};

export function SetupAggregationsDebugClient(props: { initialCars: CarRow[] }) {
  const [carId, setCarId] = useState<string>("");
  const [cars, setCars] = useState<CarRow[]>(props.initialCars);
  const [rows, setRows] = useState<AggRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = carId ? `?carId=${encodeURIComponent(carId)}` : "";
      const res = await fetch(`/api/setup-aggregations${q}`);
      const data = (await res.json()) as {
        cars?: CarRow[];
        aggregations?: AggRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.cars) setCars(data.cars);
      setRows(data.aggregations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [carId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rebuild = async () => {
    setRebuilding(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/setup-aggregations/rebuild", { method: "POST" });
      const data = (await res.json()) as {
        deletedRows?: number;
        createdRows?: number;
        documentsConsidered?: number;
        documentsIncluded?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMessage(
        `Rebuild OK: ${data.createdRows ?? 0} rows (from ${data.documentsIncluded ?? 0}/${data.documentsConsidered ?? 0} eligible docs); deleted ${data.deletedRows ?? 0} prior rows.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  };

  const carLabel = useMemo(() => {
    const m = new Map(cars.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id) ?? id;
  }, [cars]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Internal verification only. Stats use normalized{" "}
        <code className="text-xs">SetupSnapshot.data</code> from documents marked eligible for aggregation,
        with a car assigned. No filenames or document IDs are returned here.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Car filter</span>
          <select
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={carId}
            onChange={(e) => setCarId(e.target.value)}
          >
            <option value="">All my cars</option>
            {cars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.chassis ? ` (${c.chassis})` : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-md border border-border bg-muted/60 px-3 py-1.5 text-sm"
          disabled={loading}
          onClick={() => void load()}
        >
          Refresh
        </button>
        <button
          type="button"
          className="rounded-md border border-primary bg-primary/90 px-3 py-1.5 text-sm text-primary-foreground"
          disabled={rebuilding}
          onClick={() => void rebuild()}
        >
          {rebuilding ? "Rebuilding…" : "Rebuild aggregations"}
        </button>
      </div>

      {message ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">{message}</div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2">Car</th>
              <th className="p-2">Parameter</th>
              <th className="p-2">Type</th>
              <th className="p-2">N</th>
              <th className="p-2">Stats</th>
              <th className="p-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-muted-foreground">
                  {loading ? "Loading…" : "No aggregation rows. Run rebuild after marking setups eligible and assigning a car."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.carId}-${r.parameterKey}`} className="border-b border-border/60 align-top">
                  <td className="p-2 font-medium">{carLabel(r.carId)}</td>
                  <td className="p-2 font-mono text-xs">{r.parameterKey}</td>
                  <td className="p-2">{r.valueType}</td>
                  <td className="p-2 tabular-nums">{r.sampleCount}</td>
                  <td className="p-2 font-mono text-[11px] text-muted-foreground">
                    <pre className="whitespace-pre-wrap break-all">
                      {JSON.stringify(
                        r.numericStatsJson ?? r.categoricalStatsJson ?? null,
                        null,
                        0
                      )}
                    </pre>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {new Date(r.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
