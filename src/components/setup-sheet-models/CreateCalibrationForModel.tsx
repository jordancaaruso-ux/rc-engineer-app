"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

type PdfDoc = { id: string; originalFilename: string; mimeType: string };

/** Creates a calibration for a chassis from one of the user's PDFs, then opens the mapping editor. */
export function CreateCalibrationForModel({
  modelId,
  modelName,
}: {
  modelId: string;
  modelName: string;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<PdfDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docId, setDocId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/setup-documents?forExamplePdf=1", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { documents?: PdfDoc[]; error?: string };
      if (!res.ok) {
        setError(data.error || "Could not load your PDFs.");
        return;
      }
      setDocs(data.documents ?? []);
    } catch {
      setError("Could not load your PDFs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!docId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/setup-calibrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${modelName} calibration`,
          sourceType: "pdf",
          exampleDocumentId: docId,
          setupSheetModelId: modelId,
          calibrationDataJson: {
            templateType: "pdf_form_fields",
            documentMeta: { lineGroupingEpsilon: 2.5 },
            formFieldMappings: {},
            fieldMappings: {},
            fields: {},
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error || "Could not create the calibration.");
        return;
      }
      router.push(`/setup-calibrations/${data.id}`);
      router.refresh();
    } catch {
      setError("Could not create the calibration.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Pick this chassis&apos; setup sheet PDF (a fillable one reads best), then map its boxes to
        parameters.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="min-w-[16rem] max-w-full rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs"
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          disabled={loading || creating}
        >
          <option value="">{loading ? "Loading your PDFs…" : "Choose a PDF…"}</option>
          {(docs ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.originalFilename}
            </option>
          ))}
        </select>
        <Button type="button" onClick={() => void create()} disabled={!docId || creating}>
          {creating ? "Creating…" : "Create calibration"}
        </Button>
        <Link href="/cars" className="text-xs text-accent hover:underline">
          Upload a PDF
        </Link>
      </div>
      {docs && docs.length === 0 && !loading ? (
        <p className="text-xs text-muted-foreground">
          No PDFs yet — upload this chassis&apos; setup sheet first.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
