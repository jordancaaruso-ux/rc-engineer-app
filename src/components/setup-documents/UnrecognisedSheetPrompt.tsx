"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/panel";

/**
 * "We don't know this sheet — shall we learn it?"
 *
 * Shown when the calibration we used was drawn for a DIFFERENT EDITION of the same sheet: the file
 * is a perfectly good fillable PDF, but somebody rebuilt it and renamed every box, so almost none
 * of the calibration's named boxes exist in it. Measured by `sheetRecognition.ts`; no setup was
 * created, deliberately — see the refusal in `tryCreateSetupFromParsedDocument.ts`.
 *
 * The way out is the door that already exists. `POST /api/setup-sheet-models/blank` with
 * `derive: true` reads the parameter list straight off this file's own form layer and returns a
 * working chassis with EVERY box on it — the same door a driver uses for a car nobody has uploaded
 * before. So the driver ends up better off than a partial import would have left them: all 235
 * boxes rather than six.
 *
 * What they don't get yet is the Engineer understanding the boxes, because nobody has named them.
 * That is the split the north star draws (2026-08-11): using a sheet needs no names, understanding
 * one does. The copy says so rather than implying a full result.
 */
export function UnrecognisedSheetPrompt({
  docId,
  message,
  suggestedName,
  storagePath,
  originalFilename,
  mimeType,
}: {
  docId: string;
  message: string;
  suggestedName: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addAsOwnSheet() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the sheet a name so you can find it again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup-sheet-models/blank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No byteSize: the route defaults it, and the only size rules are "not empty" and
        // "not over the cap" — both already cleared when this file was accepted at upload.
        body: JSON.stringify({
          name: trimmed,
          derive: true,
          storagePath,
          originalFilename,
          mimeType,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        modelId?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Couldn't add the sheet — try again.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't add the sheet — check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <CardPanel className="flex flex-col gap-3 border-warning/40">
      <Eyebrow>Sheet not recognised</Eyebrow>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={`unrecognised-sheet-name-${docId}`}>
          Name for this sheet
        </label>
        <input
          id={`unrecognised-sheet-name-${docId}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="min-w-0 flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground"
          placeholder="e.g. Awesomatix A800RR (my sheet)"
        />
        <Button onClick={addAsOwnSheet} disabled={busy}>
          {busy ? "Adding…" : "Add as its own sheet"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        You&rsquo;ll get every box on the sheet to fill in and log runs against. The Engineer
        won&rsquo;t be able to read this one until its boxes are named.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </CardPanel>
  );
}
