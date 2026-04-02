"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Track = { id: string; name: string; location?: string | null };

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function TrackList({
  initialTracks,
  favouriteTrackIds = [],
}: {
  initialTracks: Track[];
  favouriteTrackIds?: string[];
}) {
  const favSet = new Set(favouriteTrackIds);
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    setMessage(null);
    setAdding(true);
    try {
      const { track } = await jsonFetch<{ track: Track }>("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, location: location.trim() || null }),
      });
      setTracks((prev) => [track, ...prev]);
      setName("");
      setLocation("");
      setMessage("Track added.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add track");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-muted/70 p-4 space-y-3">
        <div className="ui-title text-sm text-muted-foreground">Add track</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Silverstone National"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Location (optional)</label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. UK"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={adding}
            className={cn(
              "rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
              adding && "opacity-70 pointer-events-none"
            )}
          >
            {adding ? "Adding…" : "Add track"}
          </button>
          {message && (
            <span className={cn("text-xs", message === "Track added." ? "text-accent" : "text-muted-foreground")}>
              {message}
            </span>
          )}
        </div>
      </form>

      <div>
        <div className="ui-title text-sm text-muted-foreground mb-2">Tracks</div>
        {tracks.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/70 p-4 text-sm text-muted-foreground">
            No tracks yet. Add one above or from Log your run.
          </div>
        ) : (
          <ul className="rounded-lg border border-border divide-y divide-border">
            {tracks.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {favSet.has(t.id) && (
                    <span className="text-yellow-500 shrink-0" aria-label="Favourite" title="Favourite">
                      ★
                    </span>
                  )}
                  <div>
                    <Link href={`/tracks/${t.id}`} className="font-medium hover:underline">
                      {t.name}
                    </Link>
                    {t.location && <span className="text-muted-foreground text-sm ml-2">({t.location})</span>}
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground font-mono shrink-0">{t.id.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
