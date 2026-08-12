"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Self-contained admin verify/unverify toggle for server-rendered catalog lists. PATCHes the
 * given endpoint with `{ verified }` and refreshes the route. See docs/ASSET_ACCESS_NORTH_STAR.md.
 */
export function CatalogVerifyToggleButton({
  endpoint,
  verified,
  className,
}: {
  endpoint: string;
  verified: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verified: !verified }),
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
  }, [endpoint, verified, router]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50",
        verified ? "border-border text-muted-foreground" : "border-primary-ink/50 text-primary-ink",
        className
      )}
    >
      {busy ? "…" : verified ? "Unverify" : "Verify"}
    </button>
  );
}
