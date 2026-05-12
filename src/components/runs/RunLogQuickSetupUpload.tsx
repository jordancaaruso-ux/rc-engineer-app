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
  if (stage === "detecting") return "Detecting calibration…";
  if (stage === "creating") return "Importing…";
  return "Import setup file";
}

function scheduleStageHints(
  setStage: React.Dispatch<React.SetStateAction<UploadStage>>,
  timersRef: React.MutableRefObject<number[]>
) {
  for (const id of timersRef.current) window.clearTimeout(id);
  timersRef.current = [];
  timersRef.current.push(
    window.setTimeout(() => setStage((s) => (s === "uploading" ? "detecting" : s)), 900)
  );
  timersRef.current.push(
    window.setTimeout(() => setStage((s) => (s === "detecting" ? "creating" : s)), 2600)
  );
}

function clearTimers(timersRef: React.MutableRefObject<number[]>) {
  for (const id of timersRef.current) window.clearTimeout(id);
  timersRef.current = [];
}

export function RunLogQuickSetupUpload(props: {
  carId: string;
  /** After quick-create returns a usable setup (or needs review), parent refetches options / applies selection. */
  onImported: (documentId: string) => void | Promise<void>;
}) {
  const router = useRouter();
  const { carId, onImported } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = stage !== "idle" && stage !== "done";

  const runUpload = useCallback(
    async (file: File) => {
      setError(null);
      setStage("uploading");
      scheduleStageHints(setStage, timersRef);
      const result = await postQuickCreateSetup(file, carId);
      clearTimers(timersRef);
      if (!result.ok) {
        setError(result.error);
        setStage("idle");
        return;
      }
      const data = result.data;
      setStage("done");
      if (data.needsReview || !data.setupId) {
        router.push(`/setup-documents/${data.documentId}`);
        router.refresh();
        return;
      }
      await onImported(data.documentId);
      setStage("idle");
    },
    [carId, onImported, router]
  );

  function onFileChosen(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.currentTarget.files?.[0] ?? null;
    ev.currentTarget.value = "";
    if (!f) return;
    void runUpload(f);
  }

  function onPaste(ev: React.ClipboardEvent) {
    if (busy) return;
    const f = clipboardEventToImageFile(ev);
    if (!f) return;
    ev.preventDefault();
    void runUpload(f);
  }

  return (
    <div className="max-w-2xl rounded-md border border-primary/25 bg-primary/5 p-3 space-y-2">
      <div className="text-xs font-medium text-foreground">No saved setups for this car yet</div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Upload a <span className="font-medium text-foreground">PDF</span> setup sheet to auto-import (same as Setup
        page). Images paste here too — they usually need review until image calibrations exist.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={QUICK_CREATE_SETUP_ACCEPT_MIME}
          className="hidden"
          onChange={onFileChosen}
          disabled={busy}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md border border-primary/60 bg-primary/90 px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary disabled:opacity-60 disabled:cursor-default"
        >
          {stageLabel(stage)}
        </button>
        <div
          role="group"
          aria-label="Paste setup screenshot from clipboard"
          tabIndex={0}
          onPaste={onPaste}
          className="min-h-[2rem] flex-1 min-w-[8rem] max-w-md rounded border border-dashed border-border bg-card/60 px-2 py-1.5 text-[11px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
        >
          Click here, then <span className="font-medium text-foreground">Ctrl+V</span> to paste a screenshot
        </div>
      </div>
      {error ? (
        <p className="text-[11px] text-rose-500" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
