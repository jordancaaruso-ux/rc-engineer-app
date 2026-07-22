"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";

/**
 * One-click "derive image map" for an already-mapped AcroForm calibration. The server renders the
 * example PDF (same rasterizer real uploads use), derives image regions from the existing field
 * mappings (no AI), detects the content box, and writes the image lane onto this calibration.
 */
export function DeriveImageMapButton({
  calibrationId,
  previewUrl,
  hasImageMap,
}: {
  calibrationId: string;
  /** @deprecated no longer used — rendering happens server-side. */
  previewUrl?: string;
  hasImageMap?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  void previewUrl;

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus("Rendering the sheet and deriving image regions…");
    try {
      const res = await fetch(`/api/setup-calibrations/${calibrationId}/derive-image-map`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        derivedFields?: number;
        contentBoxDetected?: boolean;
        warnings?: string[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error?.trim() || `Derive failed (${res.status}).`);
        setStatus(null);
        return;
      }
      const n = data.derivedFields ?? 0;
      const box = data.contentBoxDetected ? " (content-box aligned)" : "";
      setStatus(`Done — derived ${n} field${n === 1 ? "" : "s"} into an image map${box}. Image/photo/PDF uploads of this sheet will now auto-extract.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to derive the image map.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [calibrationId, router]);

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
        disabled={busy}
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
