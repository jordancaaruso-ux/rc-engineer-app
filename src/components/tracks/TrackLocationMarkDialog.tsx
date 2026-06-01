"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { getCurrentPosition, GeolocationRequestError } from "@/lib/location/getCurrentPosition";

export function TrackLocationMarkDialog({
  open,
  trackId,
  trackName,
  onMarked,
  onSkip,
}: {
  open: boolean;
  trackId: string;
  trackName: string;
  onMarked: () => void;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || typeof document === "undefined") return null;

  async function markLocation() {
    setBusy(true);
    setError(null);
    try {
      const position = await getCurrentPosition();
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: position.latitude,
          longitude: position.longitude,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Could not save location (${res.status})`);
        return;
      }
      onMarked();
    } catch (e) {
      if (e instanceof GeolocationRequestError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Could not save location");
      }
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="track-location-mark-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onSkip();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="track-location-mark-title" className="ui-title text-sm text-foreground">
          Save track location?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-snug">
          You just completed your first run at{" "}
          <span className="font-medium text-foreground">{trackName}</span>. Mark where you are now so
          we can recognize this track when you return.
        </p>
        {error ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/80 transition"
            disabled={busy}
            onClick={onSkip}
          >
            Not now
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/25 transition",
              busy && "opacity-70 pointer-events-none"
            )}
            disabled={busy}
            onClick={() => void markLocation()}
          >
            {busy ? "Getting location…" : "Mark this location"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
