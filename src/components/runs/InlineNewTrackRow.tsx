"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackTimingUrls } from "@/lib/tracks/trackTimingUrl";
import {
  TrackTimingUrlsField,
  type TrackTimingUrlsFieldHandle,
} from "@/components/tracks/TrackTimingUrlsField";

const NO_TIMING_URLS: TrackTimingUrls = { liveRcUrl: null, speedhiveUrl: null };

export type InlineCreatedTrack = {
  id: string;
  name: string;
  location: string | null;
  liveRcUrl?: string | null;
  speedhiveUrl?: string | null;
};

/**
 * Create a track without leaving the run you're logging — backlog FB-01/FB-02,
 * built for onboarding (docs/ONBOARDING_NORTH_STAR.md).
 *
 * The track picker only ever offered "Track library", which navigates away
 * mid-run. A driver at an unlisted track was the one case that could genuinely
 * block *completing* a run, and asking them to leave the form to fix it is how
 * drafts get abandoned. Tracks are an open global catalog
 * (docs/ASSET_ACCESS_NORTH_STAR.md), so creating one here needs no approval.
 *
 * Asks for a timing page too (2026-08-10). A track born here used to start with no
 * LiveRC and no Speedhive page, so lap discovery searched nothing and the driver
 * pasted a session URL by hand for every run after. The person creating the track is
 * the one person who knows its timing page, and they are already typing about it —
 * TrackTimingSourceNotice further down the same form remains the second chance, and
 * the only prompt for tracks somebody else added.
 */
export function InlineNewTrackRow({
  onCreated,
  className,
}: {
  /** Hand back the new track so the caller can add it to its list and select it. */
  onCreated: (track: InlineCreatedTrack) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [timingUrls, setTimingUrls] = useState<TrackTimingUrls>(NO_TIMING_URLS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timingFieldRef = useRef<TrackTimingUrlsFieldHandle>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    // Fold in a paste they never pressed Enter on, and catch a typo here rather than
    // saving a track that silently searches nothing.
    const committed = timingFieldRef.current?.commit() ?? { ok: true as const, value: timingUrls };
    if (!committed.ok) {
      setError(committed.error);
      return;
    }
    const timing = {
      liveRcUrl: committed.value.liveRcUrl ?? undefined,
      speedhiveUrl: committed.value.speedhiveUrl ?? undefined,
    };

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          location: location.trim() || null,
          ...timing,
          // It's where they're racing — favouriting it makes it lead the picker next time.
          addToFavourites: true,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        track?: InlineCreatedTrack;
        error?: string;
        existingTrackId?: string;
      };

      // 409 = someone already added it. Select theirs rather than making a duplicate.
      // Take the server's row, which carries the timing URLs the existing track already
      // has — rebuilding it from local state reported those tracks as having none.
      if (res.status === 409 && json.existingTrackId) {
        onCreated(
          json.track ?? {
            id: json.existingTrackId,
            name: trimmed,
            location: location.trim() || null,
          }
        );
        reset();
        return;
      }
      if (!res.ok || !json.track) throw new Error(json.error || `HTTP ${res.status}`);

      onCreated(json.track);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the track");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setName("");
    setLocation("");
    setTimingUrls(NO_TIMING_URLS);
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          // Yellow-outline chip (2026-07-27): was bare yellow text — the brightest
          // thing in the track panel with no container and a text-height tap target.
          // Now a peer of the Detect chip in shape, distinguished only by tint.
          "flex min-h-8 items-center gap-1.5 rounded-lg border border-primary/45 bg-primary/[0.08] px-3 text-xs font-semibold text-primary transition hover:bg-primary/15",
          className
        )}
      >
        <Plus aria-hidden className="size-3.5" strokeWidth={2.6} />
        New track
      </button>
    );
  }

  return (
    <div className={cn("inset-panel-deep space-y-2 px-3 py-2.5", className)}>
      <input
        autoFocus
        className="ui-control w-full rounded-lg border border-border bg-input px-2.5 py-2 text-sm text-foreground"
        placeholder="Track name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void create();
          }
          if (e.key === "Escape") reset();
        }}
      />
      <input
        className="ui-control w-full rounded-lg border border-border bg-input px-2.5 py-2 text-sm text-foreground"
        placeholder="Town or suburb — optional"
        value={location}
        onChange={(e) => setLocation(e.currentTarget.value)}
      />
      <TrackTimingUrlsField
        ref={timingFieldRef}
        className="pt-0.5"
        value={timingUrls}
        onChange={setTimingUrls}
        onError={setError}
        labelClassName="block text-[11px] font-semibold text-muted-foreground"
        inputClassName="ui-control w-full rounded-lg border border-border bg-input px-2.5 py-2 text-sm text-foreground"
      />
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-primary px-2.5 py-1.5 text-[11.5px] font-bold text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add track"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="px-2 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
