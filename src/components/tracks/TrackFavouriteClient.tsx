"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data?.error || "Could not update favourite");
  }
  return data as T;
}

export function TrackFavouriteClient(props: {
  trackId: string;
  trackName: string;
  isFavourite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [isFavourite, setIsFavourite] = useState(props.isFavourite);
  const [message, setMessage] = useState<string | null>(null);

  async function toggleFavourite() {
    setMessage(null);
    setBusy(true);
    try {
      const data = await jsonFetch<{ ok: true; added: boolean }>(
        `/api/tracks/${props.trackId}/favourite`,
        { method: "POST" }
      );
      setIsFavourite(data.added);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update favourite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-2">
      <div className="text-xs font-mono text-muted-foreground">Favourites</div>
      <p className="text-sm text-muted-foreground">
        Tracks are shared reference data. Adding or removing from favourites only changes your quick-access list; it does not affect run history.
      </p>
      {isFavourite ? (
        <button
          type="button"
          className={cn(
            "rounded-md border border-border bg-secondary/30 px-4 py-2 text-xs hover:bg-secondary/40 transition",
            busy && "opacity-60 pointer-events-none"
          )}
          onClick={toggleFavourite}
          disabled={busy}
        >
          {busy ? "Updating…" : "Remove from favourites"}
        </button>
      ) : (
        <button
          type="button"
          className={cn(
            "rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition",
            busy && "opacity-60 pointer-events-none"
          )}
          onClick={toggleFavourite}
          disabled={busy}
        >
          {busy ? "Adding…" : "Add to favourites"}
        </button>
      )}
      {message && <div className="text-xs text-muted-foreground">{message}</div>}
    </div>
  );
}
