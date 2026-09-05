"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { deleteSetup } from "@/lib/setup/keepSetupClient";
import { setupDeleteConfirmMessage } from "@/lib/setup/setupRemoveMode";

/**
 * "Delete" for the setup page's action row — the same act the Saved setups card offers, on the
 * screen a driver is actually looking at when they decide they don't want it.
 *
 * Only rendered where `decideSetupRemoval` says delete is real: the page asks that question of the
 * same counts the API checks, so this button never appears on a setup the server would refuse. Its
 * neighbours are all `ActionChip`s, which are links; this is a button, so it borrows the outline
 * recipe rather than the component (`KeepSetupButton` does the same).
 *
 * It ends on the car page, not here — the page it just deleted would 404 on refresh.
 */
export function DeleteSetupButton({
  setupId,
  carId,
  name,
  derivedCount,
  className,
}: {
  setupId: string;
  /** Where to land afterwards. */
  carId: string;
  /** The title on screen, so the question names what the driver is looking at. */
  name: string;
  /** Runs and setups that started from this one — the confirm says they keep their own numbers. */
  derivedCount: number;
  className?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!window.confirm(setupDeleteConfirmMessage(name, derivedCount))) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSetup(setupId);
      startTransition(() => {
        router.push(`/cars/${carId}`);
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this setup.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        title="Delete"
        className={outlineButtonClassName(
          cn("gap-1.5 hover:border-destructive/40 hover:text-destructive disabled:opacity-50", className)
        )}
      >
        <Trash2 className="size-3.5" strokeWidth={2} aria-hidden />
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}
