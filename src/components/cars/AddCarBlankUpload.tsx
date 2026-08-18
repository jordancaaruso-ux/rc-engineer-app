"use client";

import { useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import {
  uploadBlankSheetForChassis,
  type BlankUploadModel,
} from "@/lib/setupSheetModels/blankUploadClient";

/**
 * Add a chassis nobody has added yet, by uploading the manufacturer's blank setup sheet.
 *
 * This is what "my chassis isn't listed" leads to now. It used to be a dead end that made a car
 * with no sheet and told nobody.
 *
 * THE ONE THING THE COPY HAS TO GET ACROSS is which file to pick. Manufacturers usually publish
 * two: a printable one and an editable one that looks identical on screen. Only the editable one
 * has boxes to type in, and only the editable one can become a chassis. A driver who picks the
 * wrong one gets a refusal that reads like the app is broken — so the ask names the file before
 * they go looking, and the refusal names it again. It gets **one line** to do it (2026-08-18):
 * the previous four-line caveat was the first thing on a card that already looked like a form,
 * and the requirement drowned in it. The field label below no longer repeats it either.
 *
 * The card has exactly one yellow thing at a time, and it is always the next move: "Choose file"
 * full-width until a file exists, then "Create chassis" in its place. Both wear
 * `.primary-face-static` rather than `.primary-face` — a specular band crossing a button this
 * wide reads as a screen wipe, the same call `RecentRunsCard` made.
 *
 * NO NAME GATE (2026-08-18). The picker used to stay disabled until the chassis had a name, which
 * left the card opening on a greyed-out control with nothing to press — and a yellow button you
 * cannot press is worse than a grey one. The gate bought nothing: the confirm step below already
 * handles a file with no name ("Name your chassis to create it"), and `submit()` still refuses.
 * Both inputs stay on screen in every state so a typo in the name never costs the chosen file.
 */

/**
 * The card's single yellow action, whichever one it currently is. Deliberately NOT
 * `primaryButtonClassName()`: that is the toolbar chip — 30px tall, `text-xs`, and wearing
 * `.primary-face`, whose band sweeps across it every 2.6s. Across the full width of a card the
 * same band reads as a screen wipe, so this takes the material and holds it still.
 */
const wideYellowClassName =
  "tap-active primary-face-static flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-[13px] font-bold tracking-tight text-primary-foreground transition hover:brightness-105 active:brightness-95 disabled:opacity-60";

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AddCarBlankUpload({
  onCreated,
  onAddWithoutSheet,
}: {
  /** The new chassis, ready to be selected in the form that opened this panel. */
  onCreated: (
    model: BlankUploadModel,
    summary: {
      totalBoxes: number;
      unnamedBoxes: number;
      merged: boolean;
      /** What the file already had in its boxes, saved once the car exists. */
      values: Record<string, unknown>;
      filledCount: number;
    }
  ) => void;
  /** The old path: a car with no setup sheet, kept as the landing place when a sheet won't read. */
  onAddWithoutSheet: () => void;
}) {
  const [chassisName, setChassisName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerNoSheet, setOfferNoSheet] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const named = chassisName.trim().length > 0;
  const canCreate = named && file !== null && !busy;

  async function submit() {
    if (!file || !named || busy) return;
    haptic("light");
    setBusy(true);
    setError(null);
    setOfferNoSheet(false);
    try {
      const result = await uploadBlankSheetForChassis(file, chassisName);
      if (!result.ok) {
        setError(result.error);
        setOfferNoSheet(result.offerCarWithoutSheet);
        return;
      }
      onCreated(result.model, {
        totalBoxes: result.totalBoxes,
        unnamedBoxes: result.unnamedBoxes,
        merged: result.merged,
        values: result.values,
        filledCount: result.filledCount,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border bg-card p-3">
      <div>
        <p className="text-xs text-foreground">Add your chassis from your setup sheet.</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Must be an editable PDF &mdash; no images.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-muted-foreground">Chassis name</label>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          placeholder="e.g. Mugen MTC3"
          value={chassisName}
          onChange={(e) => setChassisName(e.target.value)}
          aria-label="Chassis name"
        />
      </div>

      <div>
        {/* Not "(fillable PDF)" any more — the line at the top of the card says it once. */}
        <label className="mb-1 block text-[11px] text-muted-foreground">Setup sheet</label>
        {/*
          Hidden native input behind a styled trigger: the native "Choose file" control can't be
          greyed out or restyled, and the chosen file needs to render as a chip with a Change
          affordance. Value is cleared after every pick so re-choosing the same file still fires.
        */}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
            setOfferNoSheet(false);
            e.target.value = "";
          }}
          aria-hidden
          tabIndex={-1}
        />
        {file ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground">
              <Check className="h-3.5 w-3.5 shrink-0 text-primary-ink" aria-hidden />
              <span className="truncate">{file.name}</span>
            </span>
            <button
              type="button"
              className="shrink-0 px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              Change
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={wideYellowClassName}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label="Choose setup sheet file"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Choose file
          </button>
        )}
      </div>

      {file ? (
        <div className="rounded-md border border-border bg-background p-2.5">
          <p className="text-xs font-medium text-foreground">
            {named ? (
              <>Create &ldquo;{chassisName.trim()}&rdquo;?</>
            ) : (
              <>Name your chassis to create it.</>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            from <span className="text-foreground">{file.name}</span> · {formatFileSize(file.size)}
          </p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canCreate}
            className={cn(wideYellowClassName, "mt-2")}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            {busy ? "Reading your sheet…" : "Create chassis"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onAddWithoutSheet}
        >
          I don&rsquo;t have the sheet
        </button>
      )}

      {busy ? (
        <p className="text-[11px] text-muted-foreground">
          Reading every box off the sheet. A busy sheet takes a few seconds.
        </p>
      ) : null}

      {error ? (
        <div className={cn("space-y-2 rounded-md border p-2", "border-amber-500/40 bg-amber-500/5")}>
          <p className="text-[11px] text-warning">{error}</p>
          {offerNoSheet ? (
            <button
              type="button"
              className="btn-surface px-2 py-1 text-xs"
              onClick={onAddWithoutSheet}
            >
              Add the car without a sheet for now
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
