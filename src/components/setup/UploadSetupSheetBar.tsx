"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  FileUp,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import { Button } from "@/components/ui/Button";
import {
  postQuickCreateSetup,
  QUICK_CREATE_SETUP_ACCEPT_MIME,
  readImageFromClipboard,
  type QuickCreateMismatchInfo,
} from "@/lib/setupDocuments/quickCreateSetupClient";

export type UploadSetupCar = {
  id: string;
  name: string;
  /** Chassis / setup sheet model name, when the car has one (e.g. "Mugen MTC3"). */
  chassisName: string | null;
};

type UploadStage = "idle" | "uploading" | "matching" | "creating";

type MismatchState = QuickCreateMismatchInfo & { file: File };

function stageLabel(stage: UploadStage): string {
  if (stage === "uploading") return "Uploading…";
  if (stage === "matching") return "Reading sheet…";
  return "Creating setup…";
}

/**
 * "Upload setup sheet" flow on the Assets hub (founder-interviewed 2026-07-17):
 * an outline ghost bar above the hub card opens a two-step bottom sheet —
 * step 1 picks which car the setup is for (skipped silently with one car),
 * step 2 offers three doors: upload a file, take a photo, paste a screenshot.
 * Car-first applies to PDFs too: the server 409-blocks (nothing created) when
 * the sheet fingerprints as a different chassis than the chosen car, and the
 * sheet shows a blocking "Change car / Use anyway" confirm.
 */
export function UploadSetupSheetBar({ cars }: { cars: UploadSetupCar[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const stageTimersRef = useRef<number[]>([]);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"car" | "doors">("car");
  const [carId, setCarId] = useState<string | null>(null);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<MismatchState | null>(null);
  /** File held across a "Change car" round-trip — re-uploads when the new car is picked. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const sheet = useEnterExit(open, 300);
  const busy = stage !== "idle";
  const selectedCar = cars.find((c) => c.id === carId) ?? null;

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

  function openSheet() {
    setError(null);
    setMismatch(null);
    setPendingFile(null);
    if (cars.length === 1) {
      // One car — the question answers itself; land straight on the doors.
      setCarId(cars[0]!.id);
      setStep("doors");
    } else {
      setCarId(null);
      setStep("car");
    }
    setOpen(true);
  }

  function closeSheet() {
    if (busy) return;
    setOpen(false);
  }

  const upload = useCallback(
    async (file: File, forCarId: string, blockOnModelMismatch: boolean) => {
      setError(null);
      setMismatch(null);
      setStage("uploading");
      scheduleStageHints();
      // 3-minute timeout: slow image reads finish after the response and the
      // document page live-refreshes until done.
      const result = await postQuickCreateSetup(
        file,
        { carId: forCarId, blockOnModelMismatch },
        { timeoutMs: 180_000 }
      );
      clearStageTimers();
      setStage("idle");
      if (!result.ok) {
        if (result.mismatch) {
          setMismatch({ ...result.mismatch, file });
          return;
        }
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(`/setup-documents/${result.data.documentId}`);
      router.refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is a stable external dep
    [router]
  );

  function pickCar(id: string) {
    setCarId(id);
    setError(null);
    setStep("doors");
    if (pendingFile) {
      // Arrived here via "Change car" on a mismatch — retry with the new car right away.
      const file = pendingFile;
      setPendingFile(null);
      void upload(file, id, true);
    }
  }

  const handleFile = useCallback(
    (file: File) => {
      if (!carId) return;
      void upload(file, carId, true);
    },
    [carId, upload]
  );

  function onFileChosen(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.currentTarget.files?.[0] ?? null;
    ev.currentTarget.value = "";
    if (!f) return;
    handleFile(f);
  }

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeSheet identity is per-render by design
  }, [open, busy]);

  return (
    <>
      {/* Ghost bar: glass + hairline, yellow reserved for the icon/arrow (action accent only). */}
      <button
        type="button"
        onClick={openSheet}
        className="tap-active glass-card flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
          aria-hidden
        >
          <FileUp className="size-4" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 text-[14px] font-semibold tracking-tight text-foreground">
          Upload setup sheet
        </span>
        <ArrowRight className="size-4 shrink-0 text-primary" strokeWidth={2} aria-hidden />
      </button>

      {/* Hidden pickers live outside the sheet so the portal teardown can't cancel a chosen file. */}
      <input
        ref={fileInputRef}
        type="file"
        accept={QUICK_CREATE_SETUP_ACCEPT_MIME}
        className="hidden"
        onChange={onFileChosen}
        disabled={busy}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={onFileChosen}
        disabled={busy}
      />

      {/* Portaled to <body> like the Ideas sheet — ancestor backdrop-blur would trap `fixed`. */}
      {sheet.mounted
        ? createPortal(
            <div
              className={cn(
                "fixed inset-0 z-[60] flex items-end justify-center bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none sm:items-center",
                sheet.entered ? "opacity-100" : "opacity-0"
              )}
              role="dialog"
              aria-modal="true"
              aria-label="Upload setup sheet"
              onClick={closeSheet}
            >
              <div
                className={cn(
                  "w-full max-w-md rounded-t-2xl border border-white/10 bg-card/95 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl sm:pb-4",
                  sheet.entered ? "translate-y-0" : "translate-y-full sm:translate-y-4"
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 pt-3 sm:hidden">
                  <div className="mx-auto h-1 w-9 rounded-full bg-white/15" aria-hidden />
                </div>
                <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
                  <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                    Upload setup sheet
                  </h2>
                  <button
                    type="button"
                    onClick={closeSheet}
                    aria-label="Close"
                    className="tap-active -mr-1 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <X className="size-5" strokeWidth={2} aria-hidden />
                  </button>
                </div>

                <div className="px-4 pb-3">
                  {cars.length === 0 ? (
                    <div className="py-2">
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        Add a car first — setups attach to one of your cars.
                      </p>
                      <Link
                        href="/cars"
                        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary"
                      >
                        Add a car
                        <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden />
                      </Link>
                    </div>
                  ) : mismatch ? (
                    <div className="py-1">
                      <p className="text-[13px] leading-relaxed text-foreground">
                        This sheet reads as{" "}
                        <span className="font-semibold">
                          {mismatch.detectedModelName ?? "a different chassis"}
                        </span>
                        , but you picked{" "}
                        <span className="font-semibold">{selectedCar?.name ?? "this car"}</span>
                        {mismatch.targetModelName ? ` (${mismatch.targetModelName})` : ""}.
                      </p>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                        Nothing was imported yet. Switch to the matching car, or keep your pick and
                        sort it out on the review screen.
                      </p>
                      <div className="mt-3.5 flex items-center gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPendingFile(mismatch.file);
                            setMismatch(null);
                            setStep("car");
                          }}
                        >
                          Change car
                        </Button>
                        <Button
                          onClick={() => {
                            const m = mismatch;
                            if (!m || !carId) return;
                            void upload(m.file, carId, false);
                          }}
                        >
                          Use anyway
                        </Button>
                      </div>
                    </div>
                  ) : step === "car" ? (
                    <div>
                      <p className="pb-1 text-[13px] text-muted-foreground">
                        Which car is this setup for?
                      </p>
                      <ul className="divide-y divide-border">
                        {cars.map((car) => (
                          <li key={car.id}>
                            <button
                              type="button"
                              onClick={() => pickCar(car.id)}
                              className="tap-active flex w-full items-center gap-3 py-3 text-left"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] font-semibold tracking-tight text-foreground">
                                  {car.name}
                                </span>
                                {car.chassisName ? (
                                  <span className="block truncate text-[12px] text-muted-foreground">
                                    {car.chassisName}
                                  </span>
                                ) : null}
                              </span>
                              <ChevronRight
                                className="size-4 shrink-0 text-muted-foreground"
                                strokeWidth={2}
                                aria-hidden
                              />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-1 pb-1">
                        {cars.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (busy) return;
                              setError(null);
                              setStep("car");
                            }}
                            aria-label="Change car"
                            className="tap-active -ml-1.5 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                          >
                            <ChevronLeft className="size-4" strokeWidth={2} aria-hidden />
                          </button>
                        ) : null}
                        <p className="truncate text-[13px] text-muted-foreground">
                          For <span className="font-semibold text-foreground">{selectedCar?.name}</span>
                        </p>
                      </div>
                      {busy ? (
                        <div className="flex items-center gap-2.5 py-4">
                          <Loader2
                            className="size-4 shrink-0 animate-spin text-primary"
                            strokeWidth={2}
                            aria-hidden
                          />
                          <span className="text-[13px] text-muted-foreground">{stageLabel(stage)}</span>
                        </div>
                      ) : (
                        <ul className="divide-y divide-border">
                          <DoorRow
                            icon={<Upload className="size-4" strokeWidth={2} aria-hidden />}
                            title="Upload file"
                            hint="PDF or image from your device"
                            onClick={() => fileInputRef.current?.click()}
                          />
                          <DoorRow
                            icon={<Camera className="size-4" strokeWidth={2} aria-hidden />}
                            title="Take photo"
                            hint="Point the camera at a paper sheet"
                            onClick={() => cameraInputRef.current?.click()}
                          />
                          <DoorRow
                            icon={<ClipboardPaste className="size-4" strokeWidth={2} aria-hidden />}
                            title="Paste"
                            hint="An image or PDF you copied"
                            onClick={() => void onPasteTap()}
                          />
                        </ul>
                      )}
                      {error ? (
                        <p className="pt-2 text-[12px] text-destructive" role="alert">
                          {error}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function DoorRow({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="tap-active flex w-full items-center gap-3 py-3 text-left"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold tracking-tight text-foreground">{title}</span>
          <span className="block text-[12px] text-muted-foreground">{hint}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      </button>
    </li>
  );
}
