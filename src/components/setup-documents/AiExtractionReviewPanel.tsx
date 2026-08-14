"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

/**
 * Side-by-side review for AI-read setup sheets (SETUP_UPLOAD_NORTH_STAR.md): the sheet
 * image next to the extracted values, flagged fields first. A driver — including one who
 * doesn't know what a field means — verifies by comparing pixels: the box says 5.4, the
 * app says 5.4. Values save via the existing document PATCH; setup creation reuses the
 * existing create-setup endpoint.
 */

export type AiReviewField = {
  key: string;
  label: string;
  section: string;
  value: string;
  confidence: number;
  flagged: boolean;
  disagreed: boolean;
  /** Choice fields: pick from these (plus empty). */
  options?: string[];
  /** Normalized sheet region (from the model's blank-sheet calibration) — enables the evidence crop. */
  region?: { xPct: number; yPct: number; wPct: number; hPct: number };
};

/**
 * Evidence crop: shows just this field's pixels from the sheet, cropped with pure CSS
 * (percentage offsets need only the region + the sheet's aspect ratio — no measured sizes).
 */
function EvidenceCrop({
  previewUrl,
  region,
  sheetAspect,
}: {
  previewUrl: string;
  region: NonNullable<AiReviewField["region"]>;
  sheetAspect: number;
}) {
  // Pad the tight calibration box so the printed label around it stays visible.
  const padX = region.wPct * 0.35;
  const padY = region.hPct * 0.55;
  const x = Math.max(0, region.xPct - padX);
  const y = Math.max(0, region.yPct - padY);
  const w = Math.min(1 - x, region.wPct + padX * 2);
  const h = Math.min(1 - y, region.hPct + padY * 2);
  if (w <= 0 || h <= 0) return null;
  return (
    <div
      className="relative mt-1.5 w-full max-w-[260px] overflow-hidden rounded-md border border-border bg-white"
      style={{ aspectRatio: `${(w / h) * sheetAspect}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- cropped document preview */}
      <img
        src={previewUrl}
        alt=""
        aria-hidden
        className="absolute h-auto max-w-none"
        style={{
          width: `${(1 / w) * 100}%`,
          left: `${-(x / w) * 100}%`,
          top: `${-(y / h) * 100}%`,
        }}
      />
    </div>
  );
}

export function AiExtractionReviewPanel({
  docId,
  previewUrl,
  fields,
  createdSetupId,
  sheetAspect,
}: {
  docId: string;
  previewUrl: string;
  fields: AiReviewField[];
  createdSetupId: string | null;
  /** Width/height ratio of the calibration reference sheet — required for evidence crops. */
  sheetAspect?: number;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of fields) out[f.key] = f.value;
    return out;
  });
  const [dirty, setDirty] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [busy, setBusy] = useState<"save" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupId, setSetupId] = useState<string | null>(createdSetupId);

  const flagged = useMemo(() => fields.filter((f) => f.flagged), [fields]);
  const rest = useMemo(() => fields.filter((f) => !f.flagged), [fields]);

  function setValue(key: string, v: string) {
    setValues((cur) => ({ ...cur, [key]: v }));
    setDirty(true);
  }

  async function save(): Promise<boolean> {
    setBusy("save");
    setError(null);
    try {
      const parsedDataJson: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim() !== "") parsedDataJson[k] = v.trim();
      }
      const res = await fetch(`/api/setup-documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedDataJson, parsedSetupManuallyEdited: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      setDirty(false);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createSetup() {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setBusy("create");
    setError(null);
    try {
      const setupData: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim() !== "") setupData[k] = v.trim();
      }
      const res = await fetch(`/api/setup-documents/${docId}/create-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupData }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; setup?: { id: string } };
      if (!res.ok || !data.setup?.id) throw new Error(data.error || `Create failed (${res.status})`);
      setSetupId(data.setup.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(null);
    }
  }

  function fieldRow(f: AiReviewField) {
    const v = values[f.key] ?? "";
    return (
      <div
        key={f.key}
        className={`rounded-lg border px-3 py-2 ${f.flagged ? "border-primary-ink/40 bg-secondary" : "border-border"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground">{f.label}</div>
            <div className="truncate text-[10px] text-faint">{f.section}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {f.disagreed ? (
              <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                reads differed
              </span>
            ) : null}
            <span className="text-[10px] tabular-nums text-faint">
              {Math.round(f.confidence * 100)}%
            </span>
          </div>
        </div>
        {f.flagged && f.region && sheetAspect ? (
          <EvidenceCrop previewUrl={previewUrl} region={f.region} sheetAspect={sheetAspect} />
        ) : null}
        <div className="mt-1.5">
          {f.options && f.options.length > 0 ? (
            <select
              value={v}
              onChange={(e) => setValue(f.key, e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 tabular-nums text-xs text-foreground"
            >
              <option value="">— not set —</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              {v && !f.options.includes(v) ? <option value={v}>{v}</option> : null}
            </select>
          ) : (
            <input
              value={v}
              onChange={(e) => setValue(f.key, e.target.value)}
              placeholder="empty on sheet"
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 tabular-nums text-xs text-foreground"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page-body pb-0">
      <CardPanel contentClassName="p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <Eyebrow>AI-read setup</Eyebrow>
            <div className="mt-1 text-xs text-muted-foreground">
              Compare against the sheet — fix anything that doesn&apos;t match, then create the setup.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {setupId ? (
              <span className="rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
                Setup created ✓
              </span>
            ) : (
              <button
                onClick={createSetup}
                disabled={busy !== null}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
              >
                {busy === "create" ? "Creating…" : dirty ? "Save & create setup" : "Create setup"}
              </button>
            )}
            {dirty ? (
              <button
                onClick={() => void save()}
                disabled={busy !== null}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-60"
              >
                {busy === "save" ? "Saving…" : "Save changes"}
              </button>
            ) : null}
          </div>
        </div>
        {error ? <div className="mb-2 text-xs text-destructive">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:sticky md:top-3 md:self-start">
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- document preview, dynamic route */}
              <img
                src={previewUrl}
                alt="Uploaded setup sheet"
                onClick={() => setZoomed((z) => !z)}
                className={`${zoomed ? "w-[170%] max-w-none cursor-zoom-out" : "w-full cursor-zoom-in"} h-auto`}
              />
            </div>
            <div className="mt-1 text-[10px] text-faint">Click the sheet to zoom · scroll to pan</div>
          </div>
          <div className="space-y-2">
            {flagged.length > 0 ? (
              <>
                <div className="text-xs font-medium text-foreground">
                  Check these ({flagged.length}) — uncertain reads only
                </div>
                <div className="space-y-1.5">{flagged.map(fieldRow)}</div>
              </>
            ) : null}
            <details className="pt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Everything else ({rest.length}) — read confidently
              </summary>
              <div className="mt-2 space-y-1.5">{rest.map(fieldRow)}</div>
            </details>
          </div>
        </div>
      </CardPanel>
    </div>
  );
}
