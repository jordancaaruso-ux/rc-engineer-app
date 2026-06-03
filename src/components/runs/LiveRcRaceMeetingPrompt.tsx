"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type LiveRcMeetingDetection = {
  eventLabel: string;
  eventHubUrl: string;
  matchedEventId: string | null;
  trackName?: string | null;
};

export function LiveRcRaceMeetingPrompt({
  detection,
  busy,
  onConfirm,
  onDismiss,
}: {
  detection: LiveRcMeetingDetection;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply event");
    }
  }

  return (
    <div className="rounded-md border border-amber-500/45 bg-amber-500/10 px-3 py-2.5 text-sm space-y-2">
      <p className="text-amber-950 dark:text-amber-100 leading-snug">
        Racing at{" "}
        <span className="font-medium text-foreground">&lsquo;{detection.eventLabel}&rsquo;</span>?
        {detection.trackName ? (
          <span className="text-muted-foreground"> ({detection.trackName})</span>
        ) : null}
      </p>
      <p className="text-[11px] text-muted-foreground leading-snug">
        LiveRC shows an active race meeting today. We&apos;ll switch to Race Meeting and link this event.
      </p>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className={cn(
            "rounded-md border border-amber-600/50 bg-amber-500/20 px-3 py-1.5 text-xs font-medium hover:bg-amber-500/30 transition",
            busy && "opacity-60 pointer-events-none"
          )}
          onClick={() => void handleConfirm()}
        >
          {busy ? "Applying…" : "Yes, use this event"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/80 transition"
          onClick={onDismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
