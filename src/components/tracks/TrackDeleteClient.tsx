"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function TrackDeleteClient(props: {
  trackId: string;
  trackName: string;
  runCount: number;
  eventCount: number;
  asAdmin?: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canConfirm = confirmText.trim().toUpperCase() === "DELETE";

  async function doDelete() {
    setMessage(null);
    setBusy(true);
    try {
      await jsonFetch<{ ok: true }>(`/api/tracks/${encodeURIComponent(props.trackId)}`, {
        method: "DELETE",
      });
      router.push("/tracks");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to delete track");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
      <Eyebrow>Delete track</Eyebrow>

      {props.asAdmin ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          You are deleting this track as an admin (you did not add it).
        </p>
      ) : null}

      <div className="text-sm text-muted-foreground space-y-1 leading-snug">
        <p>
          Permanently removes <span className="font-medium text-foreground">{props.trackName}</span> from the
          community catalog, including its GPS pin.
        </p>
        {props.runCount > 0 ? (
          <p>
            {props.runCount} run{props.runCount === 1 ? "" : "s"} across all users will keep their saved track name
            but will no longer link to this track.
          </p>
        ) : null}
        {props.eventCount > 0 ? (
          <p>
            {props.eventCount} event{props.eventCount === 1 ? "" : "s"} will keep their meeting data with a legacy
            track snapshot (name, location, URLs, tags).
          </p>
        ) : null}
      </div>

      {!confirmOpen ? (
        <button
          type="button"
          className="rounded-md bg-destructive px-4 py-2 text-xs font-medium text-destructive-foreground hover:brightness-110 transition"
          onClick={() => {
            setConfirmOpen(true);
            setConfirmText("");
            setMessage(null);
          }}
        >
          Delete track…
        </button>
      ) : (
        <div className="rounded-md border border-border bg-muted/60 p-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            Type <span className="font-mono">DELETE</span> to confirm.
          </div>
          <input
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(
                "rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground hover:brightness-110 transition",
                (!canConfirm || busy) && "opacity-60 pointer-events-none"
              )}
              disabled={!canConfirm || busy}
              onClick={() => void doDelete()}
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted transition"
              onClick={() => {
                setConfirmOpen(false);
                setMessage(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}
