"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  carTemplateSelectGroups,
  shouldSkipSetupUploadCarPicker,
  type CarForTemplateGroup,
} from "@/lib/cars/setupSheetTemplateCarGroups";
import {
  clipboardEventToImageFile,
  postQuickCreateSetup,
  QUICK_CREATE_SETUP_ACCEPT_MIME,
} from "@/lib/setupDocuments/quickCreateSetupClient";

type CarOption = CarForTemplateGroup;

type UploadStage = "idle" | "uploading" | "detecting" | "creating" | "done";

function stageLabel(stage: UploadStage): string {
  if (stage === "uploading") return "Uploading…";
  if (stage === "detecting") return "Detecting calibration…";
  if (stage === "creating") return "Creating setup…";
  return "New setup";
}

export function NewSetupUploadButton({
  cars,
  defaultCarId = null,
}: {
  cars: CarOption[];
  defaultCarId?: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const stageTimersRef = useRef<number[]>([]);

  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [carPickerOpen, setCarPickerOpen] = useState(false);
  const templateGroups = useMemo(() => carTemplateSelectGroups(cars), [cars]);
  const skipPicker = useMemo(() => shouldSkipSetupUploadCarPicker(cars), [cars]);
  const [selectedCarId, setSelectedCarId] = useState(defaultCarId ?? "");

  useEffect(() => {
    if (defaultCarId) setSelectedCarId(defaultCarId);
  }, [defaultCarId]);

  useEffect(() => {
    if (templateGroups.length === 1 && !selectedCarId) {
      setSelectedCarId(templateGroups[0]!.defaultCarId);
    }
  }, [templateGroups, selectedCarId]);

  const noCars = cars.length === 0;
  const busy = stage !== "idle" && stage !== "done";

  function resolveCarIdForUpload(): string | null {
    if (selectedCarId && cars.some((c) => c.id === selectedCarId)) return selectedCarId;
    if (defaultCarId && cars.some((c) => c.id === defaultCarId)) return defaultCarId;
    if (templateGroups.length === 1) return templateGroups[0]!.defaultCarId;
    if (cars.length === 1) return cars[0]!.id;
    return null;
  }

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
    async (file: File, carId: string) => {
      setError(null);
      setStage("uploading");
      scheduleStageHints();
      const result = await postQuickCreateSetup(file, carId);
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
    const carId = resolveCarIdForUpload();
    if (!carId && !skipPicker) {
      setCarPickerOpen(true);
      return;
    }
    if (!carId) {
      setCarPickerOpen(true);
      return;
    }
    void upload(f, carId);
  }

  function openPicker() {
    if (busy) return;
    setError(null);
    if (noCars) {
      setError("Add a car under Cars before uploading setup sheets.");
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
    if (busy || noCars) return;
    const f = clipboardEventToImageFile(ev);
    if (!f) return;
    ev.preventDefault();
    beginUploadWithFile(f);
  }

  function confirmCarPicker() {
    if (!selectedCarId) return;
    const f = pendingFileRef.current;
    setCarPickerOpen(false);
    if (!f) return;
    void upload(f, selectedCarId);
  }

  function cancelCarPicker() {
    pendingFileRef.current = null;
    setCarPickerOpen(false);
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
        {noCars ? (
          <Link
            href="/cars"
            className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
            title="Add a car first"
          >
            Add car first
          </Link>
        ) : (
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="rounded-md border border-primary/60 bg-primary/90 px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary disabled:opacity-60 disabled:cursor-default"
            title="Upload a setup sheet and auto-create a setup"
          >
            {stageLabel(stage)}
          </button>
        )}
        {!noCars ? (
          <div
            tabIndex={0}
            onPaste={onPaste}
            className="rounded border border-dashed border-border/80 bg-card/40 px-2 py-1 text-[10px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
            title="Click here, then Ctrl+V to paste a screenshot"
          >
            Paste image
          </div>
        ) : null}
      </div>
      {error ? (
        <span className="text-[11px] text-rose-400" role="alert">
          {error}
        </span>
      ) : null}
      {carPickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-border bg-card p-3 shadow-lg"
        >
          <div className="text-xs font-medium text-foreground">Which setup sheet model is this for?</div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Same model is shared by all cars of that type (e.g. Mugen MTC3).
          </p>
          <select
            className="mt-2 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={selectedCarId}
            onChange={(e) => setSelectedCarId(e.target.value)}
          >
            <option value="">Select model…</option>
            {templateGroups.map((g) => (
              <option key={g.key} value={g.defaultCarId}>
                {g.label}
              </option>
            ))}
          </select>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelCarPicker}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmCarPicker}
              disabled={!selectedCarId}
              className="rounded-md border border-primary/60 bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-60 disabled:cursor-default"
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
