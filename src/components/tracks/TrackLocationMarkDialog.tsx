"use client";

import { createPortal } from "react-dom";
import { TrackLocationEditor } from "@/components/tracks/TrackLocationEditor";

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
  if (!open || typeof document === "undefined") return null;

  async function dismissAndSkip() {
    try {
      await fetch(`/api/tracks/${encodeURIComponent(trackId)}/location-prompt-dismiss`, {
        method: "POST",
      });
    } catch {
      /* still skip */
    }
    onSkip();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="track-location-mark-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) void dismissAndSkip();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="track-location-mark-title" className="ui-title text-sm text-foreground">
          Set track GPS location
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-snug">
          <span className="font-medium text-foreground">{trackName}</span> does not have GPS saved yet.
          Paste coordinates from Google Maps, or use your current location if you are at the track. This helps
          everyone find the venue on Log run.
        </p>
        <div className="mt-4">
          <TrackLocationEditor
            trackId={trackId}
            trackName={trackName}
            initial={{}}
            showCurrentLocation
            onSaved={() => onMarked()}
          />
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/80 transition"
            onClick={() => void dismissAndSkip()}
          >
            Not now
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
