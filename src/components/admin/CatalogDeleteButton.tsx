"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Deletes an unused catalog row from the review queue. Only rendered for rows with zero
 * references (the page gates on usage) — anything in use must be merged instead.
 */
export function CatalogDeleteButton({
  endpoint,
  label,
  className,
}: {
  endpoint: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    if (!window.confirm(`Delete "${label}"? It has no runs, sets, or events attached.`)) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(data.error?.trim() || `Delete failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      window.alert("Delete failed");
    } finally {
      setBusy(false);
    }
  }, [endpoint, label, router]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:opacity-50",
        className
      )}
    >
      {busy ? "…" : "Delete"}
    </button>
  );
}
