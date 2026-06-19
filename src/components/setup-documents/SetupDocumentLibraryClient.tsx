"use client";

import Link from "next/link";
import { postSetupDocumentUpload } from "@/lib/setupDocuments/setupDocumentUploadClient";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { carTemplateSelectGroups, type CarForTemplateGroup } from "@/lib/cars/setupSheetTemplateCarGroups";
import { labelForSetupSheetTemplate } from "@/lib/setupSheetTemplateId";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";

type CarOption = CarForTemplateGroup;

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
  carId: string | null;
  setupSheetTemplate?: string | null;
};

function statusClass(status: SetupDocListItem["parseStatus"]): string {
  if (status === "PARSED") return "text-emerald-300";
  if (status === "PARTIAL") return "text-amber-300";
  if (status === "FAILED") return "text-destructive";
  return "text-muted-foreground";
}

export function SetupDocumentLibraryClient({
  cars,
  initialDocuments,
}: {
  cars: CarOption[];
  initialDocuments: SetupDocListItem[];
}) {
  const router = useRouter();
  const [uploadCarId, setUploadCarId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const templateGroups = useMemo(() => carTemplateSelectGroups(cars), [cars]);

  useEffect(() => {
    if (templateGroups.length !== 1 || uploadCarId) return;
    setUploadCarId(templateGroups[0]!.defaultCarId);
  }, [templateGroups, uploadCarId]);

  async function onSelect(file: File | null) {
    if (!file) return;
    if (!uploadCarId) {
      setError("Select which setup sheet type this is for.");
      return;
    }
    setUploading(true);
    setError(null);
    setStatus(null);
    try {
      const upload = await postSetupDocumentUpload(file, { carId: uploadCarId }, { timeoutMs: 45_000 });
      if (!upload.ok) {
        setError(upload.error);
        return;
      }
      setStatus("Uploaded. Processing will begin on the review page…");
      router.push(`/setup-documents/${upload.id}`);
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
      <CardPanel>
        <div className="ui-title text-sm">Upload setup sheet</div>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF and images are stored as setup documents. Parsing creates draft values for review.
        </p>
        {cars.length === 0 ? (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            Add a car under{" "}
            <Link href="/cars" className="underline hover:text-foreground">
              Cars
            </Link>{" "}
            before uploading setup sheets.
          </p>
        ) : (
          <label className="mt-3 block text-xs">
            <span className="text-muted-foreground">Setup sheet type (shared by all cars of that type)</span>
            <select
              className="mt-1 block w-full max-w-md rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={uploadCarId}
              onChange={(e) => setUploadCarId(e.target.value)}
              disabled={uploading}
            >
              <option value="">Select type…</option>
              {templateGroups.map((g) => (
                <option key={g.key} value={g.defaultCarId}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-3 flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-border bg-muted/60 px-3 py-2 text-xs hover:bg-muted">
            <input
              type="file"
              className="hidden"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={uploading || cars.length === 0}
              onChange={(e) => onSelect(e.currentTarget.files?.[0] ?? null)}
            />
            {uploading ? "Uploading…" : "Upload setup sheet"}
          </label>
          <span className="text-[11px] text-muted-foreground">Max 12 MB</span>
        </div>
        {status ? <p className="mt-2 text-xs text-muted-foreground">{status}</p> : null}
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </CardPanel>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="ui-title text-xs text-muted-foreground">Setup documents</div>
        </div>
        {initialDocuments.length === 0 ? (
          <CardPanel>
            <div className="text-sm text-muted-foreground">No setup documents uploaded yet.</div>
          </CardPanel>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {initialDocuments.map((doc) => (
              <li key={doc.id}>
                <CardPanel contentClassName="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate ui-title text-sm normal-case">{doc.originalFilename}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {doc.createdAtLabel ?? doc.createdAt} · {doc.sourceType} ·{" "}
                    <span className={cn(statusClass(doc.parseStatus))}>{doc.parseStatus}</span>
                  {doc.importStatus && doc.importStatus !== "COMPLETED" ? (
                    <>
                      {" "}
                      · <span
                          className={cn(
                            doc.importStatus === "FAILED"
                              ? "text-destructive"
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
                    {doc.setupSheetTemplate
                      ? ` · ${labelForSetupSheetTemplate(doc.setupSheetTemplate)}`
                      : ""}
                  </div>
                {doc.importStatus === "FAILED" && doc.importErrorMessage ? (
                  <div className="mt-1 text-[11px] text-destructive line-clamp-2">{doc.importErrorMessage}</div>
                ) : null}
                </div>
                <Link
                  href={`/setup-documents/${doc.id}`}
                  className="shrink-0 rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted"
                >
                  Review
                </Link>
                </CardPanel>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

