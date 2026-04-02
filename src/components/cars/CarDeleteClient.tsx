"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function CarDeleteClient(props: { carId: string; carName: string; runCount: number }) {
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
      await jsonFetch<{ ok: true }>(`/api/cars/${props.carId}`, { method: "DELETE" });
      router.push("/cars");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
      <div className="ui-title text-sm text-muted-foreground">Delete</div>

      <div className="text-sm text-muted-foreground space-y-1">
        <div>
          This will permanently delete <span className="font-medium">{props.carName}</span>.
        </div>
        <div>
          Historical runs will remain visible. If this car was used before, history will show the saved car name.
        </div>
      </div>

      {!confirmOpen ? (
        <button
          type="button"
          className="rounded-md bg-destructive px-4 py-2 text-xs font-medium text-destructive-foreground hover:brightness-110 transition"
          onClick={() => { setConfirmOpen(true); setConfirmText(""); setMessage(null); }}
        >
          Delete car…
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
              onClick={doDelete}
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted transition"
              onClick={() => { setConfirmOpen(false); setMessage(null); }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message ? (
        <div className="text-xs text-muted-foreground">{message}</div>
      ) : null}
    </div>
  );
}

