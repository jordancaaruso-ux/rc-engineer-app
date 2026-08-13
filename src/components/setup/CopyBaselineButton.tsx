"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { haptic } from "@/lib/haptics";

/**
 * Take a published baseline and start editing your own copy of it.
 *
 * A baseline is a global row shared by everyone racing that chassis, so it is never edited in
 * place — the copy is the driver's from the moment it exists, and `sourceBaselineId` records where
 * it started so the setup can say "Copied from …" instead of appearing from nowhere.
 *
 * The car page's "Save a copy" sends the same body; this one just follows the driver into the
 * editor afterwards, because they came here to change something.
 */
export function CopyBaselineButton({
  carId,
  baselineId,
  name,
}: {
  carId: string;
  baselineId: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    setBusy(true);
    setError(null);
    haptic("light");
    try {
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carId, name, fromBaselineId: baselineId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save a copy.");
      }
      const body = (await res.json()) as { setup: { id: string } };
      router.push(`/cars/${carId}/setups/${body.setup.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save a copy.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={busy}
        className="tap-active rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Copying…" : "Save a copy and edit"}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}
