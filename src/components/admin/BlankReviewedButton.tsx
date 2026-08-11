"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Admin-only: take a refused upload off the queue, or put it back.
 *
 * The file is kept either way. This says "I have looked at this", nothing more — usually after the
 * founder has made a flat sheet fillable himself and added it through the admin door.
 */
export function BlankReviewedButton({ blankId, reviewed }: { blankId: string; reviewed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/setup-sheet-blanks/${blankId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed: !reviewed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(data.error?.trim() || `Update failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      window.alert("Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
    >
      {busy ? "Saving…" : reviewed ? "Put back" : "Done with it"}
    </button>
  );
}
