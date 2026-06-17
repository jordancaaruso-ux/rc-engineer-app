"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  modelId: string;
  isAuthorized: boolean;
};

/** Admin-only: flip a chassis type between Authorized (curated) and unverified. */
export function SetupSheetModelAuthorizeToggle({ modelId, isAuthorized }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/setup-sheet-models/${modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAuthorized: !isAuthorized }),
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
      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
    >
      {busy ? "Saving…" : isAuthorized ? "Unverify" : "Mark authorized"}
    </button>
  );
}
