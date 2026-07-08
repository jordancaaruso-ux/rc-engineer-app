"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pdfjs } from "react-pdf";
import { CardPanel } from "@/components/ui/CardPanel";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

async function renderPdfUrlToPng(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the example PDF (${res.status}).`);
  const data = await res.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a canvas context to render the PDF.");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export the rendered page."))), "image/png")
  );
}

/**
 * One-click "derive image map" for an already-mapped AcroForm calibration. Renders the example
 * PDF to a PNG client-side and posts it; the server derives image regions from the existing
 * field mappings (no AI, no screenshot) and writes the image lane onto this calibration.
 */
export function DeriveImageMapButton({
  calibrationId,
  previewUrl,
  hasImageMap,
}: {
  calibrationId: string;
  previewUrl: string;
  hasImageMap?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus("Rendering the PDF…");
    try {
      const blob = await renderPdfUrlToPng(previewUrl);
      setStatus("Deriving image regions from your field mappings…");
      const fd = new FormData();
      fd.append("png", blob, "page.png");
      const res = await fetch(`/api/setup-calibrations/${calibrationId}/derive-image-map`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        derivedFields?: number;
        warnings?: string[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error?.trim() || `Derive failed (${res.status}).`);
        setStatus(null);
        return;
      }
      const n = data.derivedFields ?? 0;
      setStatus(`Done — derived ${n} field${n === 1 ? "" : "s"} into an image map. Image/photo uploads of this sheet will now auto-extract.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to derive the image map.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [calibrationId, previewUrl, router]);

  return (
    <CardPanel contentClassName="p-3 space-y-2">
      <div className="text-sm font-medium">Image map{hasImageMap ? " · derived" : ""}</div>
      <p className="text-xs text-muted-foreground">
        Generate an image-region map from this AcroForm&rsquo;s field mappings so image/photo uploads of this sheet
        auto-extract. No screenshot needed — the PDF is rendered as the reference. Re-run after changing mappings.
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !previewUrl}
        className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        {busy ? "Working…" : hasImageMap ? "Re-derive image map" : "Derive image map"}
      </button>
      {status ? <div className="text-xs text-muted-foreground">{status}</div> : null}
      {error ? (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
      ) : null}
    </CardPanel>
  );
}
