"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileUp,
  Layers,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import { Button } from "@/components/ui/Button";
import {
  postQuickCreateSetup,
  quickCreateSetupLandingPath,
  QUICK_CREATE_SETUP_ACCEPT_MIME,
  type QuickCreateMismatchInfo,
} from "@/lib/setupDocuments/quickCreateSetupClient";

export type UploadSetupCar = {
  id: string;
  name: string;
  /** Chassis / setup sheet model name, when the car has one (e.g. "Mugen MTC3"). */
  chassisName: string | null;
  /**
   * True when this car's chassis has a green-lit calibration, so a sheet upload actually reads
   * values. False greys the upload door and says why, rather than removing it.
   */
  supportsUpload: boolean;
  /** Baselines published against this car's chassis. Zero greys the baseline door and says why. */
  baselineCount: number;
};

type UploadStage = "idle" | "uploading" | "matching" | "creating";

type MismatchState = QuickCreateMismatchInfo & { file: File };

function stageLabel(stage: UploadStage): string {
  if (stage === "uploading") return "Uploading…";
  if (stage === "matching") return "Reading sheet…";
  return "Creating setup…";
}

/**
 * "Create / Upload setup sheet" flow (founder-interviewed 2026-07-17, re-interviewed 2026-08-11):
 * an outline ghost bar opens a two-step bottom sheet — step 1 picks which car the setup is for
 * (skipped silently with one car), step 2 offers the three ways to make one.
 *
 * ============================== WHY THREE DOORS, ALWAYS ==============================
 *
 * There are exactly three ways a driver gets a setup, and they are all real: fill an empty sheet,
 * upload one they have already filled, or start from a published baseline and adjust it.
 *
 * Between 2026-08-10 and today this screen showed **one** door, and silently routed cars that
 * couldn't be read from a sheet somewhere else entirely — so which of the three you were offered
 * depended on a property of your chassis you have no way to see. The founder noticed the choices
 * had gone and could not tell where. A door that cannot work for this car is therefore SHOWN AND
 * GREYED WITH THE REASON, never removed: an absent door teaches a driver the app cannot do the
 * thing, and a greyed one with a sentence under it teaches them what would make it work.
 *
 * The fillable-PDF requirement is likewise stated BEFORE the picker rather than discovered through
 * a refusal afterwards, because a driver who is refused concludes their car is unsupported, and a
 * driver who is told what to look for goes and finds it. Car-first applies to PDFs too: the server
 * 409-blocks (nothing created) when the sheet fingerprints as a different chassis than the chosen
 * car, and the sheet shows a blocking "Change car / Use anyway" confirm.
 *
 * `trigger="link"` swaps the bar for a compact control so a card header can offer this without
 * duplicating the car picker.
 */
export function UploadSetupSheetBar({
  cars,
  trigger = "bar",
  label = "Create / Upload setup sheet",
  preselectCarId = null,
}: {
  cars: UploadSetupCar[];
  trigger?: "bar" | "link";
  label?: string;
  /** Car page sends `/cars?carId=…` when you tap "upload a sheet for this car" — skip step 1. */
  preselectCarId?: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    const preselected = preselectCarId ? (cars.find((c) => c.id === preselectCarId) ?? null) : null;
    if (preselected || cars.length === 1) {
      // The question is already answered — land straight on the doors. Every car gets the doors
      // now, including one whose chassis can't be read from a sheet: it can still fill one in.
      const only = preselected ?? cars[0]!;
      setCarId(only.id);
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
      // A clean read goes straight to the setup — on a sheet-mode chassis that page IS the
      // driver's sheet. Only an upload with a real question in it stops at the review screen.
      router.push(quickCreateSetupLandingPath(result.data));
      router.refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is a stable external dep
    [router]
  );

  /**
   * The two doors that are just a page: an empty sheet, or a baseline to start from.
   *
   * Both land on the same screen. `?start=baseline` is what tells it to offer the published
   * baselines first instead of opening straight into empty boxes.
   */
  function goToCreateSetup(id: string, start?: "baseline") {
    setOpen(false);
    router.push(`/cars/${id}/setups/new${start ? `?start=${start}` : ""}`);
  }

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
      {trigger === "link" ? (
        <button
          type="button"
          onClick={openSheet}
          className="tap-active rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
        >
          {label}
        </button>
      ) : (
        /* Ghost bar: glass + hairline, yellow reserved for the icon/arrow (action accent only). */
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
            {label}
          </span>
          <ArrowRight className="size-4 shrink-0 text-primary" strokeWidth={2} aria-hidden />
        </button>
      )}

      {/* Hidden picker lives outside the sheet so the portal teardown can't cancel a chosen file. */}
      <input
        ref={fileInputRef}
        type="file"
        accept={QUICK_CREATE_SETUP_ACCEPT_MIME}
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
              aria-label="Create or upload setup sheet"
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
                    Create / Upload setup sheet
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
                      {/*
                        No longer explains what the badge gates, because it no longer gates
                        anything: every car is offered all three ways in, and the badge is just a
                        note that this one can also read a filled-in PDF.
                      */}
                      <p className="pb-1 text-[12px] text-muted-foreground">
                        Cars marked <span className="font-medium">Sheet upload</span> can also read
                        a sheet you&apos;ve already filled in.
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
                              {car.supportsUpload ? (
                                <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  Sheet upload
                                </span>
                              ) : null}
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
                            icon={<FilePlus2 className="size-4" strokeWidth={2} aria-hidden />}
                            title="Fill in a blank sheet"
                            hint={
                              selectedCar?.chassisName
                                ? `The ${selectedCar.chassisName} sheet, empty`
                                : "Empty boxes, filled in here"
                            }
                            onClick={() => goToCreateSetup(selectedCar!.id)}
                          />
                          {/*
                           * The requirement is stated BEFORE the picker, not discovered through an
                           * error afterwards (founder ruling 2026-08-10). A driver who picks the
                           * wrong file and gets refused concludes their car is unsupported; a
                           * driver who is told what to look for goes and finds it.
                           */}
                          <DoorRow
                            icon={<Upload className="size-4" strokeWidth={2} aria-hidden />}
                            title="Upload a sheet you've filled in"
                            hint={
                              selectedCar?.supportsUpload
                                ? "The fillable PDF — the one you can type into, not a photo"
                                : undefined
                            }
                            disabledReason={
                              selectedCar?.supportsUpload
                                ? null
                                : selectedCar?.chassisName
                                  ? `We can't read a sheet for the ${selectedCar.chassisName} yet. Fill one in above and it still counts as your setup.`
                                  : "This car has no chassis sheet behind it yet, so there's nothing to read a file against."
                            }
                            onClick={() => fileInputRef.current?.click()}
                          />
                          <DoorRow
                            icon={<Layers className="size-4" strokeWidth={2} aria-hidden />}
                            title="Start from a baseline"
                            hint={
                              selectedCar && selectedCar.baselineCount > 0
                                ? `${selectedCar.baselineCount} published for this chassis — kit, base and pro`
                                : undefined
                            }
                            disabledReason={
                              selectedCar && selectedCar.baselineCount > 0
                                ? null
                                : "No baselines published for this chassis yet."
                            }
                            onClick={() => goToCreateSetup(selectedCar!.id, "baseline")}
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

/**
 * One way in. A door that can't work for this car stays on the list, greyed, with the reason under
 * it — see the "three doors, always" note at the top of this file.
 */
function DoorRow({
  icon,
  title,
  hint,
  onClick,
  disabledReason = null,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  onClick: () => void;
  /** When set, the row is inert and this is shown in place of the hint. */
  disabledReason?: string | null;
}) {
  const disabled = Boolean(disabledReason);
  return (
    <li>
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-disabled={disabled}
        className={cn(
          "flex w-full items-center gap-3 py-3 text-left",
          disabled ? "cursor-default" : "tap-active"
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted",
            disabled ? "text-muted-foreground opacity-50" : "text-foreground"
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[14px] font-semibold tracking-tight",
              disabled ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {title}
          </span>
          {disabledReason ?? hint ? (
            <span
              className={cn(
                "block text-[12px] leading-relaxed",
                disabled ? "text-faint" : "text-muted-foreground"
              )}
            >
              {disabledReason ?? hint}
            </span>
          ) : null}
        </span>
        {disabled ? null : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
        )}
      </button>
    </li>
  );
}
