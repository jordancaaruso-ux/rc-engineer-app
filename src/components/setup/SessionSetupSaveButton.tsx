"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bookmark, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { ActionToast } from "@/components/ui/ActionToast";
import { KeepSetupButton } from "@/components/setup/KeepSetupButton";
import { copySetupToCar, renameSetup } from "@/lib/setup/keepSetupClient";
import type { SetupSaveContext } from "@/lib/setup/setupSaveContext";

/**
 * Save this setup — the bookmark from the car page's All-setups list, on the Setup panel you reach
 * from inside a session (founder call, 2026-08-15).
 *
 * ============================== ONE CONTROL, TWO DEALS ==============================
 *
 * On your own run this is literally the car page's button: `KeepSetupButton`, flipping `isLibrary`
 * on the snapshot the run already points at. Same tap, same toast, same rename offer, so a setup
 * saved from here and one saved from the list are the same row with the same name.
 *
 * On a teammate's run it has to copy instead — their snapshot is theirs, and marking it would file
 * the setup in their library rather than yours. A copy needs a car to land on, which is the one
 * question this control ever asks, and it asks it only when the answer isn't obvious.
 *
 * ============================== WHY THE PANEL, NOT A MENU ==============================
 *
 * Everything it needs to say opens as a strip pinned under the modal's own sticky header, inside
 * the modal. Not a portalled popover: the sheet behind it scrolls, and a menu positioned against a
 * trigger inside a scrolling overflow box either drifts with it or needs a capture-phase listener
 * to stay glued. Anchoring to the header that is already sticky costs neither.
 */
export function SessionSetupSaveButton({
  setupId,
  save,
  className,
}: {
  setupId: string;
  save: SetupSaveContext;
  /** Sizing overrides for the row it sits in — cn is tailwind-merge, so these win. */
  className?: string;
}) {
  if (save.action === "none") return null;
  if (save.action === "mark") {
    return (
      <KeepSetupButton
        setupId={setupId}
        name={save.name}
        initialSaved={save.saved}
        className={className}
      />
    );
  }
  return <CopyToCarButton setupId={setupId} save={save} className={className} />;
}

function CopyToCarButton({
  setupId,
  save,
  className,
}: {
  setupId: string;
  save: SetupSaveContext;
  className?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * Copied during this open. The server can't answer "have I already kept this one?" — a copy
   * records nothing about where it came from — so the button only ever claims what it just did.
   * Closing and reopening the modal resets it, which is honest: it no longer knows.
   */
  const [copiedTo, setCopiedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; setupId: string } | null>(null);

  const cars = save.targetCars;

  /*
   * Escape closes the panel before it closes the modal.
   *
   * The modal listens for Escape on `window` too, so left alone one press would shut the whole
   * Setup panel while a question was still on screen — the driver loses their place to dismiss a
   * menu. Capture phase runs at `window` before the bubble phase gets back there, so stopping
   * propagation here consumes the key while the panel is open and leaves it alone when it isn't.
   */
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelOpen]);

  const copyTo = async (car: { id: string; name: string }) => {
    setBusy(true);
    setError(null);
    haptic("light");
    try {
      const created = await copySetupToCar({ setupId, carId: car.id, name: save.name });
      setCopiedTo(car.name);
      setPanelOpen(false);
      setToast({ message: `Saved to ${car.name}.`, setupId: created.id });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this setup.");
      setPanelOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string) => {
    const entered = window.prompt("Setup name", save.name);
    if (entered == null) return;
    const next = entered.trim();
    if (!next || next === save.name) return;
    try {
      await renameSetup(id, next);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename this setup.");
    }
  };

  // One car of this chassis and nothing to ask: saving IS the tap, same as on your own run.
  const onTap = () => {
    if (copiedTo) return;
    if (cars.length === 1) {
      void copyTo(cars[0]);
      return;
    }
    setPanelOpen((open) => !open);
  };

  return (
    <>
      <button
        type="button"
        onClick={onTap}
        disabled={busy || copiedTo != null}
        aria-pressed={copiedTo != null}
        aria-expanded={cars.length === 1 ? undefined : panelOpen}
        className={outlineButtonClassName(
          cn(
            "gap-1.5 disabled:opacity-50",
            copiedTo &&
              "border-primary-ink/40 bg-primary/10 text-primary-ink hover:border-primary-ink/40 hover:bg-primary/15",
            className
          )
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
        ) : (
          <Bookmark
            className="size-3.5"
            strokeWidth={2}
            fill={copiedTo ? "currentColor" : "none"}
            aria-hidden
          />
        )}
        {busy ? "Saving…" : copiedTo ? "Saved" : "Save"}
      </button>

      {panelOpen ? (
        <>
          {/*
            Tap anywhere else to put it away. Fixed rather than absolute so it covers the whole
            modal including the sheet scrolling under this bar, and it sits BELOW the panel's
            z-index so the panel's own taps still land.
          */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setPanelOpen(false)}
            aria-hidden
          />
          <div
            className="absolute right-2 top-full z-20 mt-1 w-[min(19rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
            role="group"
            aria-label="Save this setup"
          >
            {cars.length > 0 ? (
              <>
                <p className="ui-caption px-3 pt-2.5 pb-1.5 text-muted-foreground">Save to</p>
                <ul className="divide-y divide-border border-t border-border">
                  {cars.map((car) => (
                    <li key={car.id}>
                      <button
                        type="button"
                        onClick={() => void copyTo(car)}
                        disabled={busy}
                        className="tap-active w-full px-3 py-2.5 text-left text-sm font-medium transition hover:bg-muted/60 disabled:opacity-50"
                      >
                        {car.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              /*
               * No car of this chassis. Say what the setup is written for and what would let you
               * keep it — a bookmark that silently did nothing would teach the driver nothing.
               */
              <div className="space-y-2 p-3">
                {/*
                  The chassis is named in the title and nowhere else. Putting it in the sentence
                  needs an article in front of it, and "a Awesomatix A800RR" is what that produces —
                  no chassis list can be trusted to start with a consonant sound.
                */}
                <p className="text-sm font-semibold">
                  {save.chassisLabel
                    ? `No ${save.chassisLabel} in your garage`
                    : "No matching car in your garage"}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Setup values only fit the sheet they were written on, so this one needs a car of
                  that chassis.
                </p>
                <Link
                  href="/cars"
                  prefetch={false}
                  className="tap-active inline-flex text-xs font-semibold text-primary-ink underline underline-offset-4"
                >
                  Add a car
                </Link>
              </div>
            )}
            {error ? (
              <p className="border-t border-border px-3 py-2 text-xs text-destructive">{error}</p>
            ) : null}
          </div>
        </>
      ) : null}

      {error && !panelOpen ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}

      <ActionToast
        message={toast?.message ?? null}
        action={toast ? { label: "Rename", onClick: () => void rename(toast.setupId) } : null}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
