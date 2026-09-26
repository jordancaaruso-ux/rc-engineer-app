"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const ACTION_CLASS =
  "rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50";

/**
 * Remove / Dismiss on one report in the review queue (`/api/admin/reports/[id]`). Remove is only
 * offered where the queue can do it itself: a comment, or a driver reported from a team.
 */
export function ReportActions({ reportId, canRemove }: { reportId: string; canRemove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"remove" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "remove" | "dismiss") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error?.trim() || `Failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {canRemove ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("remove")}
            className={cn(ACTION_CLASS, "text-destructive")}
          >
            {busy === "remove" ? "…" : "Remove"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void act("dismiss")}
          className={cn(ACTION_CLASS, "text-muted-foreground")}
        >
          {busy === "dismiss" ? "…" : canRemove ? "Dismiss" : "Done"}
        </button>
      </div>
      {error ? <p className="max-w-[14rem] text-right text-[10px] text-destructive">{error}</p> : null}
    </div>
  );
}
