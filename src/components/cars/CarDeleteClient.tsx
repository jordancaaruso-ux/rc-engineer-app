"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Deleting a car — a quiet link, then one sheet.
 *
 * Rebuilt 2026-08-18. It used to be a card of its own, headed DELETE, with a solid `destructive`
 * button sitting loose in an ordinary panel at exactly the weight of every other control on the
 * page — so the one irreversible thing here read as an ordinary thing to press. Above it sat two
 * sentences of hedging; below it, a grey box demanding you type DELETE.
 *
 * Two calls, both the founder's:
 *
 *  - **Nothing is red until you have committed.** The door is an underlined link; the destructive
 *    fill only appears inside the sheet, where it is the answer to a question you asked.
 *  - **No typing.** Deleting a car keeps every run — that is the whole point of the one line of
 *    copy left. Type-to-confirm is the treatment for things that actually vanish (see
 *    `TrackDeleteClient`, which removes a pin from a catalog everyone shares); spending it here
 *    taught drivers to type DELETE without reading, which is the opposite of a guard.
 *
 * Portalled to `document.body` for the same reason `ExitPromptSheet` is: this opens from inside a
 * card, and any transformed ancestor turns `fixed` into `absolute` and strands the sheet mid-page.
 */
export function CarDeleteClient(props: { carId: string; carName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function doDelete() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/cars/${props.carId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Couldn't delete this car (${res.status}).`);
      router.push("/cars");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete this car.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="tap-active rounded-md px-3 py-2 text-[12.5px] text-muted-foreground underline decoration-border underline-offset-4 transition hover:text-destructive hover:decoration-destructive/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Delete this car
        </button>
      </div>

      {mounted && open
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[60] bg-black/50"
                onClick={() => !busy && setOpen(false)}
                aria-hidden
              />
              <div
                className="fixed inset-x-0 bottom-0 z-[61] mx-auto w-full max-w-md rounded-t-[22px] border-t border-border bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.45)]"
                role="dialog"
                aria-modal="true"
                aria-label={`Delete ${props.carName}`}
              >
                <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" aria-hidden />
                <div className="text-center text-[15px] font-bold tracking-tight text-foreground">
                  Delete {props.carName}?
                </div>
                <div className="pb-4 pt-1 text-center text-[12px] text-muted-foreground">
                  Old runs will remain visible.
                </div>
                {error ? (
                  <div className="pb-3 text-center text-[11px] text-destructive" role="alert">
                    {error}
                  </div>
                ) : null}
                <div className="flex gap-2 pb-1">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                    className="tap-active h-11 flex-1 rounded-full border border-border bg-card text-[13px] font-semibold transition hover:bg-muted disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void doDelete()}
                    disabled={busy}
                    aria-busy={busy}
                    className={cn(
                      "tap-active h-11 flex-1 rounded-full bg-destructive text-[13px] font-semibold text-white transition hover:brightness-110",
                      busy && "pointer-events-none opacity-60"
                    )}
                  >
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  );
}
