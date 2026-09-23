"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rememberDeletedSessions } from "@/components/laps/sessionDeletion";

/**
 * "Delete this session", at the foot of an imported session's page.
 *
 * The same quiet underlined link as "Delete this car" — a delete is not the page's point — but
 * with no confirm sheet: it goes at once and the page the driver lands on offers Undo for a few
 * seconds (founder picks, 2026-09-23). Only shown for a session that isn't on a run.
 */
export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lap-time-sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't delete this session.");
        setBusy(false);
        return;
      }
    } catch {
      setError("Couldn't reach the app just now.");
      setBusy(false);
      return;
    }
    rememberDeletedSessions([sessionId]);
    // Back to wherever it was opened from — the Tools card or the full list — where the Undo waits.
    if (window.history.length > 1) router.back();
    else router.push("/laps/analysis");
  }

  return (
    <div className="flex flex-col items-center gap-1 pt-2">
      <button
        type="button"
        onClick={() => void onDelete()}
        disabled={busy}
        aria-busy={busy}
        className="tap-active rounded-md px-3 py-2 text-[12.5px] text-muted-foreground underline decoration-border underline-offset-4 transition hover:text-destructive hover:decoration-destructive/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {busy ? "Deleting…" : "Delete this session"}
      </button>
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
