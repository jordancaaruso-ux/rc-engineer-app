"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatEventRelativeLabel } from "@/lib/formatDate";

export type EventAtTrackDetection = {
  /**
   * LiveRC's own name for the meeting it found. **Null whenever LiveRC had nothing to say** — the
   * track has no LiveRC page, or nothing is running on it — which is the normal case for club days,
   * MyRCM and Speedhive tracks and untimed test days. The prompt still appears in that case, built
   * entirely out of an event somebody in the team booked.
   */
  eventLabel: string | null;
  /** Null unless LiveRC found a meeting. Without one there is nothing to fork, so no "Make my own". */
  eventHubUrl: string | null;
  matchedEventId: string | null;
  matchedEventName: string | null;
  /** Set only when the matched event belongs to a teammate — never a stranger (it can be an email). */
  matchedEventOwnerName: string | null;
  /**
   * The match came from "my team, this track, this week" rather than an identical LiveRC results
   * link. That is a guess, so the driver is always offered a way out of it. A results-link match is
   * a real claim that this is the same meeting — forking it would split one meeting into two.
   */
  matchedIsPlanned: boolean;
  /** False when the match is booked for later in the week rather than running right now. */
  matchedIsOnToday: boolean;
  matchedStartDate: string | null;
  matchedEndDate: string | null;
  trackName?: string | null;
};

/** One of my team's events at this track that I could join. */
export type JoinableTeamEvent = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isOnToday: boolean;
  ownerName: string | null;
};

/**
 * Ledger key for "I already said no to this".
 *
 * Keyed on the LiveRC meeting when there is one, and on the matched event otherwise — without the
 * second half, every diary-only offer shared the key `track|null` and dismissing one teammate's
 * event silently suppressed every other event at that track for the rest of the session.
 */
export function eventAtTrackDismissKey(
  trackId: string,
  detection: Pick<EventAtTrackDetection, "eventHubUrl" | "matchedEventId">
): string {
  return `${trackId}|${detection.eventHubUrl ?? `event:${detection.matchedEventId ?? ""}`}`;
}

export function EventAtTrackPrompt({
  detection,
  busy,
  onConfirm,
  onCreateOwn,
  onDismiss,
}: {
  detection: EventAtTrackDetection;
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
  const owner = detection.matchedEventOwnerName;
  const track = detection.trackName?.trim();

  /**
   * When the offer is for a meeting later in the week, saying "today" would be a lie and the driver
   * would file a Wednesday test run under Saturday's race. Only shown for a booked-ahead match; a
   * results-URL match is by definition the meeting running now.
   */
  const whenLabel =
    joiningExisting && !detection.matchedIsOnToday && detection.matchedStartDate
      ? formatEventRelativeLabel({
          startDate: detection.matchedStartDate,
          endDate: detection.matchedEndDate ?? detection.matchedStartDate,
        })
      : null;

  // "Make my own" forks a fresh event off LiveRC's name for the meeting. With no LiveRC meeting there
  // is no name to fork, and the event section's own "New event" button already covers that case.
  const canCreateOwn = Boolean(
    joiningExisting && detection.matchedIsPlanned && detection.eventHubUrl
  );

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
        {joiningExisting ? (
          <>
            {owner ? `${owner}'s ` : ""}
            <span className="font-medium text-foreground">
              &lsquo;{detection.matchedEventName}&rsquo;
            </span>
            {track ? <span className="text-muted-foreground"> at {track}</span> : null}
            {whenLabel ? ` — ${whenLabel}. Join it?` : " is on today. Join it?"}
          </>
        ) : (
          <>
            Racing at{" "}
            <span className="font-medium text-foreground">
              &lsquo;{detection.eventLabel}&rsquo;
            </span>
            ?{track ? <span className="text-muted-foreground"> ({track})</span> : null}
          </>
        )}
      </p>
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
            : owner
              ? `Join ${owner}'s event`
              : joiningExisting
                ? "Yes, use this event"
                : "Yes, create this event"}
        </button>
        {canCreateOwn ? (
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
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
