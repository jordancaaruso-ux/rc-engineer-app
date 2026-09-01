"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { haptic } from "@/lib/haptics";
import { ActionToast } from "@/components/ui/ActionToast";
import { keepSetup, renameSetup } from "@/lib/setup/keepSetupClient";

/**
 * "Save" for a single setup, outside the All-setups list — the same one tap, the same toast.
 *
 * It exists because "On the car now" offered a different deal for the same job: a `window.prompt`
 * for a name, then a COPY of the run's setup. So the card above the list and the list itself
 * disagreed about what saving even meant, and using both left the car holding the setup twice.
 * This marks the snapshot, exactly as the list does.
 */
export function KeepSetupButton({
  setupId,
  name,
  initialSaved,
  className,
}: {
  setupId: string;
  /** The title on screen. Becomes the setup's name when it doesn't have one yet. */
  name: string;
  initialSaved: boolean;
  /** Sizing overrides for the row it sits in — cn is tailwind-merge, so these win. */
  className?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const toggle = async () => {
    const next = !saved;
    setBusy(true);
    setError(null);
    haptic("light");
    try {
      await keepSetup({ setupId, saved: next, name });
      setSaved(next);
      setToast(next ? `Saved “${name}”.` : null);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this setup.");
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    const entered = window.prompt("Setup name", name);
    if (entered == null) return;
    const next = entered.trim();
    if (!next || next === name) return;
    try {
      await renameSetup(setupId, next);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename this setup.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={saved}
        title={saved ? "Saved" : "Save"}
        className={outlineButtonClassName(
          cn(
            /*
             * The outline recipe, not a copy of it. This used to hand-roll its own border, radius
             * and padding, so it sat beside real outline buttons at a different corner radius
             * (6px vs 8px) and a different width — visible in every row it appears in.
             */
            "gap-1.5 disabled:opacity-50",
            saved &&
              "border-primary-ink/40 bg-primary/10 text-primary-ink hover:border-primary-ink/40 hover:bg-primary/15",
            className
          )
        )}
      >
        <Bookmark
          className="size-3.5"
          strokeWidth={2}
          fill={saved ? "currentColor" : "none"}
          aria-hidden
        />
        {busy ? "Saving…" : saved ? "Saved" : "Save"}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <ActionToast
        message={toast}
        action={toast ? { label: "Rename", onClick: () => void rename() } : null}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
