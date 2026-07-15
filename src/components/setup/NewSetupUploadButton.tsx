"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  clipboardEventToImageFile,
  postQuickCreateSetup,
  QUICK_CREATE_SETUP_ACCEPT_MIME,
  readImageFromClipboard,
} from "@/lib/setupDocuments/quickCreateSetupClient";

type UploadStage = "idle" | "uploading" | "matching" | "creating" | "done";

function stageLabel(stage: UploadStage): string {
  if (stage === "uploading") return "Uploading…";
  if (stage === "matching") return "Reading sheet…";
  if (stage === "creating") return "Creating setup…";
  return "New setup";
}

type CarOption = { id: string; name: string };

export function NewSetupUploadButton({
  defaultSetupSheetModelId = null,
  defaultCarId = null,
  cars = [],
}: {
  defaultSetupSheetModelId?: string | null;
  /** Pre-resolved car (e.g. ?carId= entry point) — skips the picker for images. */
  defaultCarId?: string | null;
  /** The user's cars, for the image "which car is this for?" picker. */
  cars?: CarOption[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stageTimersRef = useRef<number[]>([]);

  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Image waiting on a car choice before it uploads. */
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingCarId, setPendingCarId] = useState<string>("");

  const busy = stage !== "idle" && stage !== "done";

  function clearStageTimers() {
    for (const id of stageTimersRef.current) window.clearTimeout(id);
    stageTimersRef.current = [];
  }

  function scheduleStageHints() {
    clearStageTimers();
    stageTimersRef.current.push(
      window.setTimeout(() => setStage((s) => (s === "uploading" ? "matching" : s)), 900)
    );
    stageTimersRef.current.push(
      window.setTimeout(() => setStage((s) => (s === "matching" ? "creating" : s)), 2600)
    );
  }

  const upload = useCallback(
    async (file: File, carId?: string | null) => {
      setError(null);
      setStage("uploading");
      scheduleStageHints();
      // PDFs auto-match a calibration by fingerprint; images read only through the chosen car's
      // sheet calibration. 3-minute timeout: slow reads finish after the response and the
      // document page live-refreshes until done.
      const result = await postQuickCreateSetup(
        file,
        {
          ...(defaultSetupSheetModelId ? { setupSheetModelId: defaultSetupSheetModelId } : {}),
          ...(carId ? { carId } : {}),
        },
        { timeoutMs: 180_000 }
      );
      clearStageTimers();
      if (!result.ok) {
        setError(result.error);
        setStage("idle");
        return;
      }
      setStage("done");
      router.push(`/setup-documents/${result.data.documentId}`);
      router.refresh();
      setStage("idle");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router/prop are stable external deps
    [router, defaultSetupSheetModelId]
  );

  /** Route a chosen file: PDFs upload straight away; images need a car first. */
  const handleFile = useCallback(
    (file: File) => {
      const isImage = (file.type || "").toLowerCase().startsWith("image/");
      if (!isImage || defaultSetupSheetModelId || defaultCarId) {
        void upload(file, defaultCarId);
        return;
      }
      if (cars.length === 0) {
        setError("Add a car first — setups attach to one of your cars.");
        return;
      }
      if (cars.length === 1) {
        void upload(file, cars[0]!.id);
        return;
      }
      setPendingImage(file);
      setPendingCarId(cars[0]!.id);
    },
    [cars, defaultCarId, defaultSetupSheetModelId, upload]
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
    handleFile(f);
  }

  function onPaste(ev: React.ClipboardEvent) {
    if (busy) return;
    const f = clipboardEventToImageFile(ev);
    if (!f) return;
    ev.preventDefault();
    handleFile(f);
  }

  // Tap-to-paste for mobile (and click-to-paste on desktop): the `paste` event never fires on
  // touch, so pull the image straight off the clipboard via the async Clipboard API.
  async function onPasteTap() {
    if (busy) return;
    setError(null);
    const res = await readImageFromClipboard();
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    handleFile(res.file);
  }

  function confirmPendingImage() {
    const file = pendingImage;
    if (!file || !pendingCarId) return;
    setPendingImage(null);
    void upload(file, pendingCarId);
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
          title="Upload a setup sheet (PDF or image)"
        >
          {stageLabel(stage)}
        </button>
        <button
          type="button"
          onClick={onPasteTap}
          onPaste={onPaste}
          disabled={busy}
          className="rounded border border-dashed border-border/80 bg-card/40 px-2 py-1 ui-label-meta outline-none focus-visible:ring-1 focus-visible:ring-accent/40 disabled:opacity-60"
          title="Tap to paste a copied screenshot (or click here, then Ctrl+V)"
        >
          Paste image
        </button>
      </div>
      {pendingImage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/60 px-2 py-1.5">
          <span className="text-xs text-muted-foreground">Which car is this for?</span>
          <select
            value={pendingCarId}
            onChange={(ev) => setPendingCarId(ev.currentTarget.value)}
            className="ui-control rounded-md border border-border bg-secondary px-2 py-1 text-xs text-foreground"
          >
            {cars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={confirmPendingImage}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => setPendingImage(null)}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
          {error.startsWith("Add a car") ? (
            <>
              {" "}
              <Link href="/cars" className="underline">
                Add car
              </Link>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
