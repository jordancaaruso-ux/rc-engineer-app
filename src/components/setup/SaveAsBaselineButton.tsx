"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";

/**
 * Copy any setup — a run's, a sheet's — into a named baseline in the car's library. The server
 * reads the source snapshot's values, so the client only ever sends ids.
 */
export function SaveAsBaselineButton({
  carId,
  setupId,
  defaultName = "",
  label = "Save as baseline",
}: {
  carId: string;
  setupId: string;
  defaultName?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const entered = window.prompt("Name this baseline", defaultName);
    if (entered == null) return;
    const name = entered.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carId, name, fromSetupSnapshotId: setupId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save this baseline.");
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this baseline.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || pending}
        className={outlineButtonClassName("disabled:opacity-50")}
      >
        {saved ? "Saved" : label}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}
