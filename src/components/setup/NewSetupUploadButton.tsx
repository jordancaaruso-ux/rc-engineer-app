"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  postQuickCreateSetup,
  quickCreateSetupLandingPath,
  QUICK_CREATE_SETUP_ACCEPT_MIME,
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

  /**
   * Setups attach to a car, so with no cars there is nothing to upload against.
   * A pre-resolved car or a sheet-model target (model authoring, not a driver's
   * setup) both satisfy that. Checked up front rather than after a file is
   * chosen — the old post-hoc error let PDFs through entirely and only told
   * image users once they'd already picked a file.
   */
  const needsCar = !defaultSetupSheetModelId && !defaultCarId && cars.length === 0;

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
      // A clean read goes straight to the setup; only a real question stops at review.
      router.push(quickCreateSetupLandingPath(result.data));
      router.refresh();
      setStage("idle");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router/prop are stable external deps
    [router, defaultSetupSheetModelId]
  );

  /** Route a chosen file: PDFs upload straight away; images need a car first. */
  const handleFile = useCallback(
    (file: File) => {
      // Belt-and-braces: the controls are disabled when `needsCar`, but a paste
      // can still reach here. PDFs used to skip this and upload with no car.
      if (!defaultSetupSheetModelId && !defaultCarId && cars.length === 0) {
        setError("Add a car first — setups attach to one of your cars.");
        return;
      }
      const isImage = (file.type || "").toLowerCase().startsWith("image/");
      if (!isImage || defaultSetupSheetModelId || defaultCarId) {
        void upload(file, defaultCarId);
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
          disabled={busy || needsCar}
          className="rounded-md border border-primary/60 bg-primary/90 px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary disabled:opacity-60 disabled:cursor-default"
          title={needsCar ? "Add a car first" : "Upload your setup sheet (the fillable PDF)"}
        >
          {stageLabel(stage)}
        </button>
        {/*
         * "Paste image" was removed 2026-08-10: a setup sheet must be the fillable PDF, and a
         * pasted screenshot is by definition a picture. See `SETUP_DOCUMENT_ALLOWED_MIME`.
         */}
        <span className="ui-label-meta text-muted-foreground">The fillable PDF</span>
      </div>
      {needsCar ? (
        <span className="text-xs text-muted-foreground">
          Add a car first — setups attach to one of your cars.{" "}
          <Link href="/cars" className="text-primary underline">
            Add a car
          </Link>
        </span>
      ) : null}
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
