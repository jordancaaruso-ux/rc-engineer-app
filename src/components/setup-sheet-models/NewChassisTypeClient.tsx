"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

/**
 * Chassis type creation: name + the blank setup sheet, then straight into the mapping editor where
 * every parameter is created by clicking its box on the sheet.
 */
export function NewChassisTypeClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingCalibrationId, setExistingCalibrationId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || !file || busy) return;
    setBusy(true);
    setError(null);
    setExistingCalibrationId(null);
    try {
      const fd = new FormData();
      fd.append("name", trimmed);
      fd.append("pdf", file);
      const res = await fetch("/api/setup-sheet-models/blank", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        calibrationId?: string;
        existingCalibrationId?: string | null;
        error?: string;
      };
      if (!res.ok || !data.calibrationId) {
        setError(data.error?.trim() || `Could not create the chassis type (${res.status}).`);
        setExistingCalibrationId(data.existingCalibrationId ?? null);
        return;
      }
      router.push(`/setup-calibrations/${data.calibrationId}`);
    } catch {
      setError("Could not create the chassis type.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardPanel className="max-w-xl" contentClassName="space-y-4">
      <Eyebrow>New chassis type</Eyebrow>
      <p className="ui-caption">
        Name the chassis and upload its <span className="text-foreground">blank</span> setup sheet.
        You land in the mapping editor with an empty parameter list — click a box on the sheet, name
        it, and it becomes a parameter.
      </p>

      <label className="block text-xs text-muted-foreground">
        Chassis name
        <input
          className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Schumacher Mi10"
          autoFocus
        />
      </label>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Blank setup sheet (PDF)</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="block w-full text-xs"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-[11px] text-muted-foreground">
          A fillable (AcroForm) sheet gives you clickable boxes for every value. A flat sheet still
          works, but it has no boxes to click — calibrate that one as an image instead.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          {error}
          {existingCalibrationId ? (
            <>
              {" "}
              <Link href={`/setup-calibrations/${existingCalibrationId}`} className="text-primary-ink hover:underline">
                Open its mapping editor
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => void create()} disabled={busy || !name.trim() || !file}>
          {busy ? "Creating…" : "Create & start mapping"}
        </Button>
        <Link href="/setup-sheet-models" className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </Link>
      </div>
    </CardPanel>
  );
}
