"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type LiveRcMeetingDetection = {
  eventLabel: string;
  eventHubUrl: string;
  matchedEventId: string | null;
  matchedEventName: string | null;
  matchedEventOwnerName: string | null;
  /**
   * The match came from "same track, dates overlap today" rather than an identical LiveRC results
   * link. That is a guess, so the driver is always offered a way out of it. A results-link match is
   * a real claim that this is the same meeting — forking it would split one meeting into two.
   */
  matchedIsPlanned: boolean;
  trackName?: string | null;
};

export function LiveRcRaceMeetingPrompt({
  detection,
  busy,
  onConfirm,
  onCreateOwn,
  onDismiss,
}: {
  detection: LiveRcMeetingDetection;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCreateOwn: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  /**
   * We are about to put this run on an event that already exists, under a name someone else chose.
   * Say so — and say whose it is when they are a teammate. Without this the driver only ever saw
   * LiveRC's label for the meeting and had no idea the event was named anything else.
   */
  const joiningExisting = Boolean(detection.matchedEventId && detection.matchedEventName);
  const differentName =
    joiningExisting && detection.matchedEventName !== detection.eventLabel;

  async function run(action: () => void | Promise<void>) {
    setError(null);
    try {
      await action();
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
        {differentName ? (
          <>
            {detection.matchedEventOwnerName
              ? `${detection.matchedEventOwnerName} already has this meeting open as `
              : "This meeting is already open as "}
            <span className="font-medium text-foreground">
              &ldquo;{detection.matchedEventName}&rdquo;
            </span>
            . Your runs will sit under that name alongside everyone else on it.
          </>
        ) : joiningExisting ? (
          <>LiveRC shows an active race meeting today. We&apos;ll switch to Race Meeting and link this event.</>
        ) : (
          <>
            LiveRC shows an active race meeting today. We&apos;ll switch to Race Meeting and create
            this event under your name — you can rename it whenever you like.
          </>
        )}
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
          onClick={() => void run(onConfirm)}
        >
          {busy
            ? "Applying…"
            : detection.matchedEventOwnerName
              ? `Use ${detection.matchedEventOwnerName}'s event`
              : "Yes, use this event"}
        </button>
        {joiningExisting && detection.matchedIsPlanned ? (
          <button
            type="button"
            disabled={busy}
            className={cn(
              "rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/80 transition",
              busy && "opacity-60 pointer-events-none"
            )}
            onClick={() => void run(onCreateOwn)}
          >
            Make my own
          </button>
        ) : null}
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
