"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
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
  /** After quick-create returns a usable setup, parent refetches options / applies selection. */
  onImported: (documentId: string) => void | Promise<void>;
  /** Refetch downloaded-setup list (e.g. after review in another tab). */
  onRefetchList?: () => void | Promise<void>;
  /** `banner` when the list is empty; `inline` when adding another sheet. */
  variant?: "banner" | "inline";
  /**
   * When false (default on Log run), review/calibration opens in a new tab so form
   * state on this page is preserved.
   */
  navigateAwayOnReview?: boolean;
}) {
  const router = useRouter();
  const {
    carId,
    onImported,
    onRefetchList,
    variant = "banner",
    navigateAwayOnReview = false,
  } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const busy = stage !== "idle" && stage !== "done";

  const goToFollowUp = useCallback(
    (path: string) => {
      if (navigateAwayOnReview) {
        router.push(path);
        router.refresh();
        return;
      }
      window.open(path, "_blank", "noopener,noreferrer");
      setInfo("Opened in a new tab — finish there, then refresh the list below.");
      setStage("idle");
    },
    [navigateAwayOnReview, router]
  );

  const runUpload = useCallback(
    async (file: File) => {
      setError(null);
      setInfo(null);
      setStage("uploading");
      scheduleStageHints(setStage, timersRef);
      const result = await postQuickCreateSetup(file, { carId });
      clearTimers(timersRef);
      if (!result.ok) {
        setError(result.error);
        setStage("idle");
        return;
      }
      const data = result.data;
      setStage("done");
      const isImageMime = file.type?.toLowerCase().startsWith("image/");
      if (isImageMime && data.pickSource === "none" && !data.setupId) {
        goToFollowUp(`/setup-documents/${data.documentId}/calibrate-image`);
        return;
      }
      if (data.needsReview || !data.setupId) {
        goToFollowUp(`/setup-documents/${data.documentId}`);
        return;
      }
      await onImported(data.documentId);
      setStage("idle");
    },
    [carId, goToFollowUp, onImported]
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

  const controls = (
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
        className={cn(
          "min-h-[2rem] rounded border border-dashed border-border bg-card/60 px-2 py-1.5 text-[11px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-accent/50",
          variant === "banner" ? "flex-1 min-w-[8rem] max-w-md" : "min-w-[6rem] flex-1 max-w-xs"
        )}
      >
        Click here, then <span className="font-medium text-foreground">Ctrl+V</span> to paste a screenshot
      </div>
      {onRefetchList ? (
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/80 hover:text-foreground transition disabled:opacity-60"
          onClick={() => void onRefetchList()}
        >
          Refresh list
        </button>
      ) : null}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="max-w-2xl space-y-1.5">
        <p className="text-[11px] text-muted-foreground leading-snug">
          Import a setup PDF or paste a screenshot — no need to leave this page.
        </p>
        {controls}
        {info ? <p className="text-[11px] text-amber-800 dark:text-amber-200">{info}</p> : null}
        {error ? (
          <p className="text-[11px] text-rose-500" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="max-w-2xl rounded-md border border-primary/25 bg-primary/5 p-3 space-y-2">
      <div className="text-xs font-medium text-foreground">Import a setup sheet</div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Upload a <span className="font-medium text-foreground">PDF</span> or paste a{" "}
        <span className="font-medium text-foreground">screenshot</span> to add it to Downloaded setups
        for this car. First-time image templates need a one-off calibration in a new tab — your run
        form stays here.
      </p>
      {controls}
      {info ? <p className="text-[11px] text-amber-800 dark:text-amber-200">{info}</p> : null}
      {error ? (
        <p className="text-[11px] text-rose-500" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
