"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Create a track without leaving the run you're logging — backlog FB-01/FB-02,
 * built for onboarding (docs/ONBOARDING_NORTH_STAR.md).
 *
 * The track picker only ever offered "Track library", which navigates away
 * mid-run. A driver at an unlisted track was the one case that could genuinely
 * block *completing* a run, and asking them to leave the form to fix it is how
 * drafts get abandoned. Tracks are an open global catalog
 * (docs/ASSET_ACCESS_NORTH_STAR.md), so creating one here needs no approval.
 */
export function InlineNewTrackRow({
  onCreated,
  className,
}: {
  /** Hand back the new track so the caller can add it to its list and select it. */
  onCreated: (track: { id: string; name: string; location: string | null }) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          location: location.trim() || null,
          // It's where they're racing — favouriting it makes it lead the picker next time.
          addToFavourites: true,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        track?: { id: string; name: string; location: string | null };
        error?: string;
        existingTrackId?: string;
      };

      // 409 = someone already added it. Select theirs rather than making a duplicate.
      if (res.status === 409 && json.existingTrackId) {
        onCreated({
          id: json.existingTrackId,
          name: trimmed,
          location: location.trim() || null,
        });
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
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 text-[11.5px] font-semibold text-primary transition hover:brightness-110",
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
