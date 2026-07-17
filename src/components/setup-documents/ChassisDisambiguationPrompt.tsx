"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

export type ChassisChoice = { modelId: string; modelName: string };

/**
 * Tap-to-answer "which chassis is this?" — shown when an uploaded PDF's form layout is shared by
 * more than one chassis (e.g. Mugen MTC3 & Awesomatix A800RR use identical AcroForm field names)
 * and filename/garage hints couldn't split them. One tap resolves it via /resolve-chassis, which
 * re-picks the calibration scoped to the chosen chassis and re-parses under the right template.
 */
export function ChassisDisambiguationPrompt({
  docId,
  candidates,
}: {
  docId: string;
  candidates: ChassisChoice[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!candidates.length) return null;

  async function choose(modelId: string) {
    setBusyId(modelId);
    setError(null);
    try {
      const res = await fetch(`/api/setup-documents/${docId}/resolve-chassis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupSheetModelId: modelId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Couldn't set the chassis — try again.");
        setBusyId(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't set the chassis — try again.");
      setBusyId(null);
    }
  }

  return (
    <CardPanel className="border-primary/30" contentClassName="space-y-3 p-4">
      <Eyebrow>Which chassis?</Eyebrow>
      <p className="text-sm text-foreground">
        This sheet&apos;s layout is shared by more than one chassis, so it can&apos;t be told apart
        automatically. Which one is it?
      </p>
      <div className="flex flex-wrap gap-2">
        {candidates.map((c) => (
          <button
            key={c.modelId}
            type="button"
            disabled={busyId !== null}
            onClick={() => void choose(c.modelId)}
            className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:border-primary/60 hover:bg-muted disabled:opacity-60 disabled:cursor-default"
          >
            {busyId === c.modelId ? "Setting…" : c.modelName}
          </button>
        ))}
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </CardPanel>
  );
}
