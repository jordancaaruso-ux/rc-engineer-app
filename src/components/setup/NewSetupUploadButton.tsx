"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clipboardEventToImageFile,
  postQuickCreateSetup,
  QUICK_CREATE_SETUP_ACCEPT_MIME,
} from "@/lib/setupDocuments/quickCreateSetupClient";
import { dedupeSetupSheetModelsForPicker } from "@/lib/setupSheetModels/pickerModels";

type PickerModel = {
  id: string;
  name: string;
  slug: string;
  carCount: number;
  calibrationCount: number;
};

type UploadStage = "idle" | "uploading" | "detecting" | "creating" | "done";

function stageLabel(stage: UploadStage): string {
  if (stage === "uploading") return "Uploading…";
  if (stage === "detecting") return "Detecting calibration…";
  if (stage === "creating") return "Creating setup…";
  return "New setup";
}

export function NewSetupUploadButton({
  defaultSetupSheetModelId = null,
}: {
  defaultSetupSheetModelId?: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const stageTimersRef = useRef<number[]>([]);

  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickerModels, setPickerModels] = useState<PickerModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState(defaultSetupSheetModelId ?? "");
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    if (defaultSetupSheetModelId) setSelectedModelId(defaultSetupSheetModelId);
  }, [defaultSetupSheetModelId]);

  useEffect(() => {
    setModelsLoading(true);
    fetch("/api/setup-sheet-models", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (d: {
          pickerModels?: PickerModel[];
          models?: PickerModel[];
        }) => {
          const raw = d.pickerModels ?? d.models ?? [];
          setPickerModels(
            d.pickerModels ?? dedupeSetupSheetModelsForPicker(raw)
          );
        }
      )
      .catch(() => setPickerModels([]))
      .finally(() => setModelsLoading(false));
  }, []);

  const busy = stage !== "idle" && stage !== "done";

  function clearStageTimers() {
    for (const id of stageTimersRef.current) window.clearTimeout(id);
    stageTimersRef.current = [];
  }

  function scheduleStageHints() {
    clearStageTimers();
    stageTimersRef.current.push(
      window.setTimeout(() => setStage((s) => (s === "uploading" ? "detecting" : s)), 900)
    );
    stageTimersRef.current.push(
      window.setTimeout(() => setStage((s) => (s === "detecting" ? "creating" : s)), 2600)
    );
  }

  const upload = useCallback(
    async (file: File, setupSheetModelId: string) => {
      setError(null);
      setStage("uploading");
      scheduleStageHints();
      const result = await postQuickCreateSetup(file, { setupSheetModelId });
      clearStageTimers();
      if (!result.ok) {
        setError(result.error);
        setStage("idle");
        return;
      }
      setStage("done");
      const data = result.data;
      const docId = data.documentId;
      const isImageMime = file.type?.toLowerCase().startsWith("image/");
      if (isImageMime && data.pickSource === "none" && !data.setupId) {
        router.push(`/setup-documents/${docId}/calibrate-image`);
        router.refresh();
      } else if (data.needsReview || !data.setupId) {
        router.push(`/setup-documents/${docId}`);
        router.refresh();
      } else {
        const params = new URLSearchParams();
        params.set("created", docId);
        params.set("setupId", data.setupId);
        if (data.calibrationName) params.set("calibration", data.calibrationName);
        if (data.calibrationAmbiguous) params.set("calibrationAmbiguous", "1");
        router.push(`/setup?${params.toString()}`);
        router.refresh();
      }
      setStage("idle");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router-only external dep
    [router]
  );

  function beginUploadWithFile(f: File) {
    pendingFileRef.current = f;
    setModelPickerOpen(true);
  }

  function openPicker() {
    if (busy) return;
    setError(null);
    if (!modelsLoading && pickerModels.length === 0) {
      setError("Add a setup sheet model under Cars → New car & setup sheet.");
      return;
    }
    fileInputRef.current?.click();
  }

  function onFileChosen(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.currentTarget.files?.[0] ?? null;
    ev.currentTarget.value = "";
    if (!f) return;
    beginUploadWithFile(f);
  }

  function onPaste(ev: React.ClipboardEvent) {
    if (busy) return;
    const f = clipboardEventToImageFile(ev);
    if (!f) return;
    ev.preventDefault();
    beginUploadWithFile(f);
  }

  function confirmModelPicker() {
    if (!selectedModelId) return;
    const f = pendingFileRef.current;
    setModelPickerOpen(false);
    if (!f) return;
    void upload(f, selectedModelId);
  }

  function cancelModelPicker() {
    pendingFileRef.current = null;
    setModelPickerOpen(false);
  }

  function pickerLabel(m: PickerModel): string {
    const parts = [m.name];
    if (m.carCount > 0) parts.push(`${m.carCount} car${m.carCount === 1 ? "" : "s"}`);
    if (m.calibrationCount > 0) {
      parts.push(`${m.calibrationCount} cal${m.calibrationCount === 1 ? "" : "s"}`);
    }
    return parts.join(" · ");
  }

  return (
    <div className="relative inline-flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={QUICK_CREATE_SETUP_ACCEPT_MIME}
        className="hidden"
        onChange={onFileChosen}
        disabled={busy}
      />
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={openPicker}
          disabled={busy || modelsLoading}
          className="rounded-md border border-primary/60 bg-primary/90 px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary disabled:opacity-60 disabled:cursor-default"
          title="Upload a setup sheet and auto-create a setup"
        >
          {modelsLoading ? "Loading…" : stageLabel(stage)}
        </button>
        <div
          tabIndex={0}
          onPaste={onPaste}
          className="rounded border border-dashed border-border/80 bg-card/40 px-2 py-1 ui-label-meta outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
          title="Click here, then Ctrl+V to paste a screenshot"
        >
          Paste image
        </div>
      </div>
      {error ? (
        <span className="text-xs text-rose-400" role="alert">
          {error}
        </span>
      ) : null}
      {modelPickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-md border border-border bg-card p-3 shadow-lg"
        >
          <div className="ui-title text-sm normal-case">Which chassis is this setup for?</div>
          <p className="mt-1 ui-label-meta">
            One setup sheet model per car type (e.g. Mugen MTC3). Calibrations are matched to this
            choice.
          </p>
          <select
            className="mt-2 block w-full rounded-md border border-border bg-background px-2.5 py-2 ui-control"
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
          >
            <option value="">Select chassis type…</option>
            {pickerModels.map((m) => (
              <option key={m.id} value={m.id}>
                {pickerLabel(m)}
              </option>
            ))}
          </select>
          <p className="mt-2 ui-label-meta">
            New chassis?{" "}
            <Link href="/cars/new/setup" className="text-accent underline">
              Add car &amp; setup sheet
            </Link>
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelModelPicker}
              className="rounded-md border border-border bg-card px-2 py-1 ui-label-meta hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmModelPicker}
              disabled={!selectedModelId}
              className="rounded-md border border-primary/60 bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60 disabled:cursor-default"
            >
              Upload
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
