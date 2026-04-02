"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

export function BulkImportBatchClient({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [batch, setBatch] = useState<BatchPayload | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

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
    setActionErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      for (let i = 0; i < files.length; i++) fd.append("files", files[i]);
      const res = await fetch(`/api/setup-import-batches/${batchId}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setActionErr(data.error ?? "Upload failed");
        return;
      }
      await load();
      router.refresh();
    } finally {
      setUploading(false);
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
        <div>
          <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground mb-1">Add PDFs</div>
          <input
            type="file"
            accept="application/pdf"
            multiple
            disabled={uploading}
            onChange={(e) => void onUploadFiles(e.target.files)}
            className="text-xs"
          />
        </div>
        {uploading ? <span className="text-xs text-muted-foreground">Uploading…</span> : null}
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
                  <td className="px-3 py-2 max-w-[140px] text-[10px] text-muted-foreground" title={d.calibrationProfile?.name ?? ""}>
                    {d.calibrationProfile?.name ?? "— none —"}
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
        replaces the previous one for that file. Each PDF can use a different calibration.
      </p>
    </div>
  );
}
