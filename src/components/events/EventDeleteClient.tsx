"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * "Delete meeting" at the foot of a meeting's page, shown only to the driver who made it while
 * nobody else is on it (founder ruling 2026-09-26). Two taps, not the track page's type-DELETE:
 * nothing is lost, because the driver's runs stay as days at the track. The confirm button says so.
 */
export function EventDeleteClient(props: { eventId: string; myRunCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runs = props.myRunCount;
  const confirmLabel =
    runs === 0 ? "Yes, delete it" : `Delete, keep my ${runs} run${runs === 1 ? "" : "s"}`;

  async function doDelete() {
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(props.eventId)}/delete`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      router.push("/events");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't delete the meeting");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 pt-2">
      {!confirming ? (
        <button
          type="button"
          className="rounded-md border border-destructive/40 px-4 py-2 text-xs font-medium text-destructive hover:bg-destructive/5 transition"
          onClick={() => {
            setConfirming(true);
            setMessage(null);
          }}
        >
          Delete meeting
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              "rounded-md bg-destructive px-4 py-2 text-xs font-medium text-destructive-foreground hover:brightness-110 transition",
              busy && "opacity-60 pointer-events-none"
            )}
            disabled={busy}
            onClick={() => void doDelete()}
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Keep it
          </button>
        </div>
      )}
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}
