"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { pdfjs } from "react-pdf";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/panel";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

type ImageRegion = { xPct: number; yPct: number; wPct: number; hPct: number };

type ReviewField = {
  key: string;
  displayLabel: string;
  section: string;
  valueType: "text" | "choice";
  options?: string[];
  universalParameterId?: string;
  regions: ImageRegion[];
  /** Local-only: driver can drop a field the AI shouldn't have surfaced. */
  include: boolean;
};

type Step = "name" | "review" | "done";

async function renderFirstPageToPng(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a canvas context to render the PDF.");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL("image/png");
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export the rendered page."))), "image/png")
  );
  return { blob, dataUrl };
}

/**
 * Setup sheet MODEL authoring (a car *type* in the app catalog — not a driver's personal car,
 * which lives in Assets › Cars). AcroForm-first, upload-first: name it, upload the editable
 * AcroForm PDF, the AI drafts the parameter list from the exact box geometry, you review it.
 */
export function SetupSheetModelWizardClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [reviewFields, setReviewFields] = useState<ReviewField[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [model, setModel] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [reused, setReused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setWarnings([]);
      const nm = name.trim();
      if (!nm) {
        setError("Enter a sheet model name first.");
        return;
      }
      if (file.type && file.type !== "application/pdf") {
        setError("Upload the editable AcroForm PDF for this sheet.");
        return;
      }
      setBusy(true);
      setBusyLabel("Rendering the PDF…");
      try {
        const { blob, dataUrl } = await renderFirstPageToPng(file);
        setPreviewDataUrl(dataUrl);
        setBusyLabel("Detecting fields with AI (this takes ~30–60s)…");
        const fd = new FormData();
        fd.append("pdf", file);
        fd.append("png", blob, "page.png");
        fd.append("name", nm);
        const res = await fetch("/api/setup-sheet-models/draft-from-pdf", { method: "POST", body: fd });
        const data = (await res.json().catch(() => ({}))) as {
          fields?: Omit<ReviewField, "include">[];
          warnings?: string[];
          error?: string;
        };
        if (!res.ok) {
          setError(data.error?.trim() || `Field detection failed (${res.status}).`);
          return;
        }
        const fields: ReviewField[] = (data.fields ?? []).map((f) => ({ ...f, include: true }));
        if (fields.length === 0) {
          setError("No fields were detected on this sheet.");
          return;
        }
        setReviewFields(fields);
        setWarnings(data.warnings ?? []);
        setStep("review");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to process the PDF.");
      } finally {
        setBusy(false);
        setBusyLabel("");
      }
    },
    [name]
  );

  const handleCreate = useCallback(async () => {
    setError(null);
    const included = reviewFields.filter((f) => f.include);
    if (included.length === 0) {
      setError("Keep at least one field.");
      return;
    }
    setBusy(true);
    setBusyLabel("Creating the sheet model…");
    try {
      const res = await fetch("/api/setup-sheet-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          draftedFields: included.map((f) => ({
            key: f.key,
            displayLabel: f.displayLabel,
            section: f.section,
            valueType: f.valueType,
            ...(f.options ? { options: f.options } : {}),
            ...(f.universalParameterId ? { universalParameterId: f.universalParameterId } : {}),
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        model?: { id: string; name: string; slug: string };
        reused?: boolean;
        error?: string;
      };
      if (!res.ok || !data.model) {
        setError(data.error?.trim() || `Create failed (${res.status}).`);
        return;
      }
      setModel(data.model);
      setReused(Boolean(data.reused));
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create the sheet model.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }, [name, reviewFields]);

  const activeField = reviewFields.find((f) => f.key === activeKey) ?? null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {(["name", "review", "done"] as const).map((s, i) => (
          <span
            key={s}
            className={step === s ? "rounded bg-foreground/15 px-2 py-0.5 text-foreground" : "px-2 py-0.5"}
          >
            {i + 1}. {s === "name" ? "Name & PDF" : s === "review" ? "Review parameters" : "Done"}
          </span>
        ))}
      </div>

      {error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground">
          {error}
        </div>
      ) : null}

      {busy ? (
        <div className="rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {busyLabel || "Working…"}
        </div>
      ) : null}

      {step === "name" && (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <Eyebrow>New setup sheet model</Eyebrow>
          <p className="text-[11px] text-muted-foreground">
            This defines a car <span className="font-medium text-foreground">type</span> shared across the app — not
            your personal car (add that in Assets › Cars). Upload the editable AcroForm PDF and the AI drafts the
            parameter list from the sheet&rsquo;s exact field boxes.
          </p>
          <label className="block text-xs text-muted-foreground">
            Model name *
            <input
              className="mt-1 w-full rounded border border-border bg-muted/40 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mugen MTC3"
            />
          </label>
          <div className="space-y-2">
            <div className="text-xs font-medium text-foreground/90">Editable AcroForm PDF *</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              disabled={busy || !name.trim()}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Must be an editable AcroForm sheet (has fillable fields). Flat or scanned PDFs are rejected — the AI
              needs the real field boxes to be accurate.
            </p>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <Eyebrow>Review parameters ({reviewFields.filter((f) => f.include).length})</Eyebrow>
            <p className="text-[11px] text-muted-foreground">
              Click a parameter to highlight its box on the sheet. Rename anything the AI mislabelled, or untick a
              field to drop it. You can refine types, options, and layout after creating the model.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] gap-4">
            <div className="rounded-md border border-border bg-card overflow-hidden self-start">
              <div className="relative">
                {previewDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewDataUrl} alt="Setup sheet" className="block w-full h-auto select-none" draggable={false} />
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground">No preview.</div>
                )}
                <div className="absolute inset-0 pointer-events-none">
                  {reviewFields
                    .filter((f) => f.include)
                    .flatMap((f) =>
                      f.regions.map((r, i) => {
                        const active = f.key === activeKey;
                        return (
                          <div
                            key={`${f.key}-${i}`}
                            className="absolute"
                            style={{
                              left: `${r.xPct * 100}%`,
                              top: `${r.yPct * 100}%`,
                              width: `${r.wPct * 100}%`,
                              height: `${r.hPct * 100}%`,
                              border: `${active ? 2 : 1}px solid ${active ? "#FFD60A" : "rgba(148,163,184,0.5)"}`,
                              background: active ? "rgba(255,214,10,0.18)" : "transparent",
                            }}
                          />
                        );
                      })
                    )}
                </div>
              </div>
            </div>

            <aside className="space-y-3">
              {warnings.length > 0 ? (
                <details className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                  <summary className="cursor-pointer">{warnings.length} drafting warning(s)</summary>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5 font-mono">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <div className="max-h-[520px] overflow-auto rounded-md border border-border bg-card p-2 space-y-1">
                {reviewFields.map((f) => (
                  <div
                    key={f.key}
                    onMouseEnter={() => setActiveKey(f.key)}
                    onClick={() => setActiveKey(f.key)}
                    className={`rounded border px-2 py-1.5 text-xs cursor-pointer ${
                      f.key === activeKey ? "border-primary/60 bg-primary/5" : "border-border/60"
                    } ${f.include ? "" : "opacity-50"}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={f.include}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setReviewFields((prev) => prev.map((x) => (x.key === f.key ? { ...x, include: on } : x)));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Include ${f.displayLabel}`}
                      />
                      <input
                        value={f.displayLabel}
                        onChange={(e) => {
                          const v = e.target.value;
                          setReviewFields((prev) => prev.map((x) => (x.key === f.key ? { ...x, displayLabel: v } : x)));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
                      />
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] shrink-0">
                        {f.valueType === "choice" ? "choice" : "text"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-6 text-[10px] text-muted-foreground">
                      <span className="font-mono">{f.key}</span>
                      {f.section ? <span>· {f.section}</span> : null}
                      {f.universalParameterId ? (
                        <span className="rounded bg-sky-500/15 px-1 py-0.5 font-mono text-sky-200">
                          ↗ {f.universalParameterId}
                        </span>
                      ) : null}
                      {f.valueType === "choice" && f.options?.length ? (
                        <span className="truncate">{f.options.join(" / ")}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Button disabled={busy} onClick={() => void handleCreate()} className="text-sm">
                  {busy ? "Creating…" : "Create sheet model"}
                </Button>
                <button
                  type="button"
                  disabled={busy}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setStep("name");
                    setReviewFields([]);
                    setActiveKey(null);
                    setWarnings([]);
                  }}
                >
                  Start over
                </button>
              </div>
              {activeField ? (
                <p className="text-[10px] text-muted-foreground">
                  Highlighted: <span className="font-medium text-foreground">{activeField.displayLabel}</span>{" "}
                  ({activeField.regions.length} box{activeField.regions.length === 1 ? "" : "es"})
                </p>
              ) : null}
            </aside>
          </div>
        </div>
      )}

      {step === "done" && model && (
        <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-100">
            {reused ? `“${model.name}” already existed — using the shared model.` : `“${model.name}” is ready.`}
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            <li>
              <Link href={`/setup-sheet-models/${model.id}/schema`} className="text-accent hover:underline">
                Refine parameters (types, options, layout)
              </Link>
            </li>
            <li>Next: calibrate the AcroForm to map each field, then derive the image map.</li>
            <li>
              <Link href="/cars" className="text-accent hover:underline">
                Add your car in Assets › Cars
              </Link>{" "}
              and pick this model.
            </li>
          </ul>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => router.push("/setup-sheet-models")}
          >
            Back to chassis types
          </button>
        </div>
      )}
    </div>
  );
}
