"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  clipboardEventToImageFile,
  postQuickCreateSetup,
  QUICK_CREATE_SETUP_ACCEPT_MIME,
} from "@/lib/setupDocuments/quickCreateSetupClient";

type UploadStage = "idle" | "uploading" | "detecting" | "creating" | "done";

function stageLabel(stage: UploadStage): string {
  if (stage === "uploading") return "Uploading…";
  if (stage === "detecting") return "Detecting chassis…";
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
  const stageTimersRef = useRef<number[]>([]);

  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);

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
    async (file: File) => {
      setError(null);
      setStage("uploading");
      scheduleStageHints();
      // Auto-detect the chassis from the fingerprint; pass a model only when the entry point set one.
      const result = await postQuickCreateSetup(
        file,
        defaultSetupSheetModelId ? { setupSheetModelId: defaultSetupSheetModelId } : {}
      );
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
      if (isImageMime && data.pickSource === "none" && !data.setupId && !data.detectedModelId) {
        router.push(`/setup-documents/${docId}/calibrate-image`);
        router.refresh();
      } else {
        router.push(`/setup-documents/${docId}`);
        router.refresh();
      }
      setStage("idle");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router/prop are stable external deps
    [router, defaultSetupSheetModelId]
  );

  function openFilePicker() {
    if (busy) return;
    setError(null);
    fileInputRef.current?.click();
  }

  function onFileChosen(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.currentTarget.files?.[0] ?? null;
    ev.currentTarget.value = "";
    if (!f) return;
    void upload(f);
  }

  function onPaste(ev: React.ClipboardEvent) {
    if (busy) return;
    const f = clipboardEventToImageFile(ev);
    if (!f) return;
    ev.preventDefault();
    void upload(f);
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
          onClick={openFilePicker}
          disabled={busy}
          className="rounded-md border border-primary/60 bg-primary/90 px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary disabled:opacity-60 disabled:cursor-default"
          title="Upload any setup sheet — the chassis is detected automatically"
        >
          {stageLabel(stage)}
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
    </div>
  );
}
