"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

type SetupDocListItem = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sourceType: "PDF" | "IMAGE";
  parseStatus: "PENDING" | "PARSED" | "PARTIAL" | "FAILED";
  importStatus?: "PENDING" | "PROCESSING" | "FAILED" | "COMPLETED" | "COMPLETED_WITH_WARNINGS";
  currentStage?: string | null;
  lastCompletedStage?: string | null;
  importErrorMessage?: string | null;
  parserType: string | null;
  createdAt: string;
  updatedAt: string;
  /** Deterministic server-rendered timestamp label to avoid hydration mismatch. */
  createdAtLabel?: string;
  createdSetupId: string | null;
};

function statusClass(status: SetupDocListItem["parseStatus"]): string {
  if (status === "PARSED") return "text-emerald-300";
  if (status === "PARTIAL") return "text-amber-300";
  if (status === "FAILED") return "text-rose-300";
  return "text-muted-foreground";
}

export function SetupDocumentLibraryClient({
  initialDocuments,
}: {
  initialDocuments: SetupDocListItem[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function onSelect(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setStatus(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 45000);
      const res = await fetch("/api/setup-documents", { method: "POST", body: fd, signal: controller.signal });
      window.clearTimeout(timeoutId);
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; note?: string | null };
      if (!res.ok || !data.id) {
        setError(data.error || "Upload failed.");
        return;
      }
      setStatus("Uploaded. Processing will begin on the review page…");
      router.push(`/setup-documents/${data.id}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      const aborted = e instanceof Error && e.name === "AbortError";
      setError(aborted ? "Upload timed out. Try again." : msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="page-body space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="ui-title text-sm">Upload setup sheet</div>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF and images are stored as setup documents. Parsing creates draft values for review.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-border bg-muted/60 px-3 py-2 text-xs hover:bg-muted">
            <input
              type="file"
              className="hidden"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(e) => onSelect(e.currentTarget.files?.[0] ?? null)}
            />
            {uploading ? "Uploading…" : "Upload setup sheet"}
          </label>
          <span className="text-[11px] text-muted-foreground">Max 12 MB</span>
        </div>
        {status ? <p className="mt-2 text-xs text-muted-foreground">{status}</p> : null}
        {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-2 ui-title text-xs uppercase tracking-wide text-muted-foreground">
          Setup documents
        </div>
        {initialDocuments.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No setup documents uploaded yet.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {initialDocuments.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate ui-title text-sm">{doc.originalFilename}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {doc.createdAtLabel ?? doc.createdAt} · {doc.sourceType} ·{" "}
                    <span className={cn(statusClass(doc.parseStatus))}>{doc.parseStatus}</span>
                  {doc.importStatus && doc.importStatus !== "COMPLETED" ? (
                    <>
                      {" "}
                      · <span
                          className={cn(
                            doc.importStatus === "FAILED"
                              ? "text-rose-300"
                              : doc.importStatus === "COMPLETED_WITH_WARNINGS"
                                ? "text-amber-200"
                                : "text-muted-foreground"
                          )}
                        >
                        {doc.importStatus}
                      </span>
                      {doc.lastCompletedStage ? <span className="ml-1 font-mono text-[10px] opacity-80">({doc.lastCompletedStage})</span> : null}
                    </>
                  ) : null}
                    {doc.createdSetupId ? " · setup created" : ""}
                  </div>
                {doc.importStatus === "FAILED" && doc.importErrorMessage ? (
                  <div className="mt-1 text-[11px] text-rose-300 line-clamp-2">{doc.importErrorMessage}</div>
                ) : null}
                </div>
                <Link
                  href={`/setup-documents/${doc.id}`}
                  className="shrink-0 rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted"
                >
                  Review
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

