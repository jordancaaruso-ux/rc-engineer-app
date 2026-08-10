"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
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
 * they go looking, and the refusal names it again.
 */

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

  const canSubmit = chassisName.trim().length > 0 && file !== null && !busy;

  async function submit() {
    if (!file || busy) return;
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
          {/*
            No space is needed straight after the closing tag. JSX drops one there, which turned
            "fillable PDF — the one" into "fillable PDF— the one" on the rendered page; leading the
            next text node with punctuation sidesteps it rather than relying on an escape.
          */}
          It has to be the <span className="text-foreground">fillable PDF</span>, the one you can
          type into. Your manufacturer&rsquo;s blank works, and so does a sheet you&rsquo;ve already
          filled in: whatever is in the boxes comes with it.
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
        <label className="mb-1 block text-[11px] text-muted-foreground">Setup sheet (fillable PDF)</label>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:text-foreground"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
            setOfferNoSheet(false);
          }}
          aria-label="Setup sheet (fillable PDF)"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="btn-surface inline-flex items-center gap-1.5 px-2 py-1 text-xs disabled:opacity-60"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden />
          {busy ? "Reading your sheet…" : "Add chassis from sheet"}
        </button>
        <button
          type="button"
          className="px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onAddWithoutSheet}
        >
          I don&rsquo;t have the sheet
        </button>
      </div>

      {busy ? (
        <p className="text-[11px] text-muted-foreground">
          Reading every box off the sheet. A busy sheet takes a few seconds.
        </p>
      ) : null}

      {error ? (
        <div className={cn("space-y-2 rounded-md border p-2", "border-amber-500/40 bg-amber-500/5")}>
          <p className="text-[11px] text-amber-700 dark:text-amber-400">{error}</p>
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
