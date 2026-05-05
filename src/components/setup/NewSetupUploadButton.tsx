"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { carTemplateSelectGroups, type CarForTemplateGroup } from "@/lib/cars/setupSheetTemplateCarGroups";

type CarOption = CarForTemplateGroup;

type QuickCreateResponse = {
  documentId: string;
  setupId: string | null;
  calibrationId: string | null;
  calibrationName: string | null;
  pickSource: "exact_fingerprint" | "ambiguous_suggestion" | "none";
  pickDebug: string;
  parseStatus: "PENDING" | "PARSED" | "PARTIAL" | "FAILED";
  needsReview: boolean;
  needsReviewReason: string | null;
  calibrationAmbiguous: boolean;
};

type UploadStage = "idle" | "uploading" | "detecting" | "creating" | "done";

const ACCEPT_MIME = "application/pdf,image/jpeg,image/png,image/webp";

function stageLabel(stage: UploadStage): string {
  if (stage === "uploading") return "Uploading…";
  if (stage === "detecting") return "Detecting calibration…";
  if (stage === "creating") return "Creating setup…";
  return "New setup";
}

export function NewSetupUploadButton({ cars }: { cars: CarOption[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const stageTimersRef = useRef<number[]>([]);

  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [carPickerOpen, setCarPickerOpen] = useState(false);
  const templateGroups = useMemo(() => carTemplateSelectGroups(cars), [cars]);
  const [selectedCarId, setSelectedCarId] = useState("");

  useEffect(() => {
    if (templateGroups.length === 1 && !selectedCarId) {
      setSelectedCarId(templateGroups[0]!.defaultCarId);
    }
  }, [templateGroups, selectedCarId]);

  const noCars = cars.length === 0;
  const busy = stage !== "idle" && stage !== "done";

  function clearStageTimers() {
    for (const id of stageTimersRef.current) window.clearTimeout(id);
    stageTimersRef.current = [];
  }

  function scheduleStageHints() {
    // Best-effort visual progression while the request is in flight. Endpoint does the real work;
    // these timers just keep the label moving so the click feels responsive on slow parses.
    clearStageTimers();
    stageTimersRef.current.push(
      window.setTimeout(() => setStage((s) => (s === "uploading" ? "detecting" : s)), 900)
    );
    stageTimersRef.current.push(
      window.setTimeout(() => setStage((s) => (s === "detecting" ? "creating" : s)), 2600)
    );
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
    pendingFileRef.current = f;
    if (templateGroups.length > 1 && !selectedCarId) {
      setCarPickerOpen(true);
      return;
    }
    const carId = selectedCarId || templateGroups[0]?.defaultCarId;
    if (!carId) {
      setCarPickerOpen(true);
      return;
    }
    void upload(f, carId);
  }

  async function upload(file: File, carId: string) {
    setError(null);
    setStage("uploading");
    scheduleStageHints();
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("carId", carId);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 60000);
      const res = await fetch("/api/setup-documents/quick-create", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);
      const data = (await res.json().catch(() => ({}))) as Partial<QuickCreateResponse> & {
        error?: string;
      };
      if (!res.ok || !data.documentId) {
        setError(data.error || "Upload failed.");
        setStage("idle");
        clearStageTimers();
        return;
      }
      clearStageTimers();
      setStage("done");
      const docId = data.documentId;
      if (data.needsReview || !data.setupId) {
        router.push(`/setup-documents/${docId}`);
        router.refresh();
        return;
      }
      const params = new URLSearchParams();
      params.set("created", docId);
      params.set("setupId", data.setupId);
      if (data.calibrationName) params.set("calibration", data.calibrationName);
      if (data.calibrationAmbiguous) params.set("calibrationAmbiguous", "1");
      router.push(`/setup?${params.toString()}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      const aborted = e instanceof Error && e.name === "AbortError";
      setError(aborted ? "Upload timed out. Try again." : msg);
      setStage("idle");
      clearStageTimers();
    }
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
    <div className="relative inline-flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_MIME}
        className="hidden"
        onChange={onFileChosen}
        disabled={busy}
      />
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
          <div className="text-xs font-medium text-foreground">Which setup sheet type is this for?</div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Same type is shared for all cars of that type (e.g. two A800RR builds).
          </p>
          <select
            className="mt-2 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={selectedCarId}
            onChange={(e) => setSelectedCarId(e.target.value)}
          >
            <option value="">Select type…</option>
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
