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
        userCars?: {
          deletedRows?: number;
          createdRows?: number;
          conditionDeletedRows?: number;
          conditionCreatedRows?: number;
          documentsConsidered?: number;
          documentsIncluded?: number;
          exclusionCounts?: {
            totalUserDocuments?: number;
            excludedNotEligible?: number;
            excludedParseStatus?: number;
            excludedPlaceholder?: number;
            excludedNoPayload?: number;
            excludedNoCar?: number;
            excludedAmbiguousCar?: number;
            excludedSnapshotCarWrongOwner?: number;
            excludedSparseData?: number;
            eligibleDocuments?: number;
          };
        };
        community?: {
          deletedRows?: number;
          createdRows?: number;
          documentsIncluded?: number;
          exclusionCounts?: {
            totalDocumentsExamined?: number;
            excludedNotEligible?: number;
            excludedParseStatus?: number;
            excludedNoPayload?: number;
            excludedNoCar?: number;
            excludedNoTemplate?: number;
            excludedSparseData?: number;
            eligibleDocuments?: number;
          };
        };
        /** Legacy flat shape (older API) */
        deletedRows?: number;
        createdRows?: number;
        conditionDeletedRows?: number;
        conditionCreatedRows?: number;
        documentsConsidered?: number;
        documentsIncluded?: number;
        exclusionCounts?: {
          totalUserDocuments?: number;
          excludedNotEligible?: number;
          excludedParseStatus?: number;
          excludedPlaceholder?: number;
          excludedNoPayload?: number;
          excludedNoCar?: number;
          excludedAmbiguousCar?: number;
          excludedSnapshotCarWrongOwner?: number;
          excludedSparseData?: number;
          eligibleDocuments?: number;
        };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      const uc = data.userCars ?? data;
      const x = uc.exclusionCounts;
      const detail =
        x != null
          ? ` · examined ${x.totalUserDocuments ?? "—"} docs · eligible ${x.eligibleDocuments ?? uc.documentsIncluded ?? 0}` +
            ` · excl: not-eligible ${x.excludedNotEligible ?? 0}, parse ${x.excludedParseStatus ?? 0}, placeholder ${x.excludedPlaceholder ?? 0}` +
            `, no-payload ${x.excludedNoPayload ?? 0}, no-car ${x.excludedNoCar ?? 0}, multi-car ${x.excludedAmbiguousCar ?? 0}` +
            `, car-mismatch ${x.excludedSnapshotCarWrongOwner ?? 0}, sparse ${x.excludedSparseData ?? 0}`
          : "";
      const comm = data.community;
      const commLine =
        comm != null
          ? ` Community (eligible uploads by template): ${comm.createdRows ?? 0} rows, ${comm.documentsIncluded ?? 0} docs; deleted ${comm.deletedRows ?? 0} prior.` +
            (comm.exclusionCounts
              ? ` Examined ${comm.exclusionCounts.totalDocumentsExamined ?? "—"} · eligible ${comm.exclusionCounts.eligibleDocuments ?? 0}` +
                ` · excl: no-template ${comm.exclusionCounts.excludedNoTemplate ?? 0}, sparse ${comm.exclusionCounts.excludedSparseData ?? 0}.`
              : "")
          : "";
      setMessage(
        `Rebuild OK: ${uc.createdRows ?? 0} CAR_PARAMETER rows (${uc.documentsIncluded ?? 0} docs included); deleted ${uc.deletedRows ?? 0} prior rows.` +
          ` Condition: ${uc.conditionCreatedRows ?? 0} rows (deleted ${uc.conditionDeletedRows ?? 0} prior).${detail}${commLine}`
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
        <code className="text-xs">SetupSnapshot.data</code> when present, otherwise{" "}
        <code className="text-xs">parsedDataJson</code> (bulk import). Car comes from the snapshot or, if you
        have exactly one car, that car. No filenames or document IDs are returned here.
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
