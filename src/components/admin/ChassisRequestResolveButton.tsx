"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

/** Dismisses a pending chassis-type request from the review queue (marks it resolved). */
export function ChassisRequestResolveButton({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/chassis-requests/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(data.error?.trim() || `Dismiss failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      window.alert("Dismiss failed");
    } finally {
      setBusy(false);
    }
  }, [id, router]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50",
        className
      )}
    >
      {busy ? "…" : "Dismiss"}
    </button>
  );
}
