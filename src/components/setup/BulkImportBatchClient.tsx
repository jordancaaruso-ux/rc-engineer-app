"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type CarOption = { id: string; name: string };

type DocRow = {
  id: string;
  originalFilename: string;
  parseStatus: string;
  importStatus: string;
  importOutcome: string | null;
  importErrorMessage: string | null;
  calibrationProfileId: string | null;
  parsedCalibrationProfileId: string | null;
  calibrationProfile: { id: string; name: string } | null;
  calibrationResolvedSource: string | null;
  calibrationResolvedDebug: string | null;
  importDatasetReviewStatus: string;
  eligibleForAggregationDataset: boolean;
  identity: {
    name?: string;
    date?: string;
    track?: string;
    race?: string;
    country?: string;
  };
};

type BatchPayload = {
  id: string;
  name: string | null;
  calibrationProfile: { id: string; name: string; sourceType: string } | null;
  documents: DocRow[];
};

export function BulkImportBatchClient({
  batchId,
  cars,
}: {
  batchId: string;
  cars: CarOption[];
}) {
  const router = useRouter();
  const [batch, setBatch] = useState<BatchPayload | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [uploadCarId, setUploadCarId] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  useEffect(() => {
    if (cars.length !== 1 || uploadCarId) return;
    setUploadCarId(cars[0].id);
  }, [cars, uploadCarId]);

  const load = useCallback(async () => {
    setLoadErr(null);
    const res = await fetch(`/api/setup-import-batches/${batchId}`);
    const data = (await res.json().catch(() => ({}))) as {
      batch?: BatchPayload;
      counts?: Record<string, number>;
      error?: string;
    };
    if (!res.ok) {
      setLoadErr(data.error ?? "Failed to load batch");
      return;
    }
    if (data.batch) setBatch(data.batch);
    if (data.counts) setCounts(data.counts);
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUploadFiles(files: FileList | null) {
    if (!files?.length) return;
    if (!uploadCarId) {
      setActionErr("Select which car these setup sheets belong to.");
      return;
    }
    setActionErr(null);
    setUploading(true);
    try {
      const list = Array.from(files);
      for (let i = 0; i < list.length; i++) {
        const fd = new FormData();
        fd.append("files", list[i]);
        fd.set("carId", uploadCarId);
        const res = await fetch(`/api/setup-import-batches/${batchId}/upload`, {
          method: "POST",
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; count?: number };
        if (!res.ok) {
          setActionErr(
            data.error ??
              `Upload failed for “${list[i].name}” (${i + 1} of ${list.length}). Files may be too large for one request (host limit ~4.5MB).`
          );
          return;
        }
        if (typeof data.count === "number" && data.count < 1) {
          setActionErr(`Upload returned no documents for “${list[i].name}”.`);
          return;
        }
      }
      await load();
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error during upload";
      setActionErr(msg);
    } finally {
      setUploading(false);
    }
  }

  async function resetAggregationsToThisBatch() {
    const confirmed = window.confirm(
      "Clear aggregation eligibility on all your setup documents, then include only exact-match PARSED docs from this batch, and rebuild aggregations?"
    );
    if (!confirmed) return;
    setActionErr(null);
    setResetResult(null);
    setResetBusy(true);
    try {
      const res = await fetch("/api/setup-aggregations/reset-to-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, include: "parsed_exact" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        disabledCount?: number;
        enabledCount?: number;
        qualifyingInBatch?: number;
        community?: { documentsIncluded?: number; createdRows?: number };
      };
      if (!res.ok) {
        setActionErr(data.error ?? "Failed to reset aggregations to this batch.");
        return;
      }
      setResetResult(
        `Cleared ${data.disabledCount ?? 0} eligible docs, enabled ${data.enabledCount ?? 0} (of ${
          data.qualifyingInBatch ?? 0
        } qualifying). Community rebuild included ${data.community?.documentsIncluded ?? 0} docs across ${
          data.community?.createdRows ?? 0
        } rows.`
      );
      await load();
      router.refresh();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  }

  if (loadErr) {
    return <div className="rounded-lg border border-destructive/50 bg-card p-4 text-sm text-destructive">{loadErr}</div>;
  }
  if (!batch || !counts) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <span className="text-foreground font-medium">{counts.total}</span> total
        </span>
        <span>
          <span className="text-foreground font-medium">{counts.parsed}</span> parsed
        </span>
        <span>
          <span className="text-foreground font-medium">{counts.failed}</span> failed
        </span>
        <span>
          <span className="text-foreground font-medium">{counts.pending}</span> pending
        </span>
        <span>
          <span className="text-foreground font-medium">{counts.confirmed}</span> confirmed
        </span>
        <span>
          <span className="text-foreground font-medium">{counts.eligibleAggregation}</span> aggregation-eligible
        </span>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-end gap-3">
        {cars.length === 0 ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Add a car under{" "}
            <Link href="/cars" className="underline hover:text-foreground">
              Cars
            </Link>{" "}
            before uploading PDFs.
          </p>
        ) : (
          <label className="text-xs">
            <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground mb-1">Car for new PDFs</div>
            <select
              className="mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={uploadCarId}
              onChange={(e) => setUploadCarId(e.target.value)}
              disabled={uploading}
            >
              <option value="">Select car…</option>
              {cars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground mb-1">Add PDFs</div>
          <input
            type="file"
            accept="application/pdf"
            multiple
            disabled={uploading || cars.length === 0}
            onChange={(e) => void onUploadFiles(e.target.files)}
            className="text-xs"
          />
        </div>
        {uploading ? <span className="text-xs text-muted-foreground">Uploading…</span> : null}
        <div className="ml-auto flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void resetAggregationsToThisBatch()}
            disabled={resetBusy || uploading}
            className="rounded-md border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            title="Clear eligibility on all your docs, include only exact-match PARSED docs from this batch, and rebuild aggregations."
          >
            {resetBusy ? "Rebuilding…" : "Use only this batch for aggregations"}
          </button>
          {resetResult ? (
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 max-w-xs text-right">{resetResult}</div>
          ) : null}
          <a
            href="/setup/aggregations-debug"
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            View parameter audit / grip archetypes on a car page
          </a>
        </div>
      </div>
      {actionErr ? <div className="text-xs text-destructive">{actionErr}</div> : null}

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 font-medium">File</th>
              <th className="px-3 py-2 font-medium">Calibration</th>
              <th className="px-3 py-2 font-medium">Parse</th>
              <th className="px-3 py-2 font-medium">Identity</th>
              <th className="px-3 py-2 font-medium">Review</th>
              <th className="px-3 py-2 font-medium">Dataset</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {batch.documents.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-muted-foreground">
                  No files yet. Upload PDFs above.
                </td>
              </tr>
            ) : (
              batch.documents.map((d) => (
                <tr key={d.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 max-w-[180px] truncate" title={d.originalFilename}>
                    {d.originalFilename}
                  </td>
                  <td
                    className="px-3 py-2 max-w-[180px] text-[10px] text-muted-foreground"
                    title={d.calibrationResolvedDebug ?? d.calibrationProfile?.name ?? ""}
                  >
                    <div className="truncate">{d.calibrationProfile?.name ?? "— none —"}</div>
                    {d.calibrationResolvedSource === "exact_fingerprint" ? (
                      <div className="text-[9px] text-emerald-600 dark:text-emerald-400">auto: exact match</div>
                    ) : d.calibrationResolvedDebug ? (
                      <div className="text-[9px] text-amber-600 dark:text-amber-400 truncate" title={d.calibrationResolvedDebug}>
                        {d.calibrationResolvedDebug.replace(/^petitrc:auto\s*/i, "")}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={
                        d.parseStatus === "FAILED"
                          ? "text-destructive"
                          : d.parseStatus === "PENDING"
                            ? "text-muted-foreground"
                            : "text-foreground"
                      }
                    >
                      {d.parseStatus}
                    </span>
                    {d.importErrorMessage ? (
                      <div className="text-[10px] text-destructive max-w-[200px] truncate" title={d.importErrorMessage}>
                        {d.importErrorMessage}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-muted-foreground max-w-[200px]">
                    {[d.identity.name, d.identity.date, d.identity.track, d.identity.race, d.identity.country]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{d.importDatasetReviewStatus}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {d.eligibleForAggregationDataset ? "Included" : "Excluded"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/setup/bulk-import/${batchId}/${d.id}`}
                      className="rounded-md border border-border px-2 py-1 hover:bg-muted"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Open a PDF to choose a calibration and parse. Re-parse with another calibration anytime; the latest result
        replaces the previous one for that file. Each PDF can use a different calibration. To pull setups from PetitRC,
        create a new batch on{" "}
        <Link href="/setup/bulk-import" className="underline underline-offset-2 hover:text-foreground">
          Bulk setup import
        </Link>{" "}
        (batch name + PetitRC URL).
      </p>
    </div>
  );
}
