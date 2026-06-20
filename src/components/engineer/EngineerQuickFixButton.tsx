"use client";

import { useCallback, useState } from "react";
import type { QuickFixPayloadV1 } from "@/lib/engineerPhase5/quickFix/quickFixTypes";
import { EngineerQuickFixCard } from "@/components/engineer/EngineerQuickFixCard";
import { EngineerNavIcon } from "@/components/layout/EngineerNavIcon";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/utils";

type QuickFixResponse = {
  quickFix?: QuickFixPayloadV1;
  error?: string;
};

export function EngineerQuickFixButton({
  runId,
  className,
  compact = false,
}: {
  runId: string;
  className?: string;
  /** Smaller button for dense run-detail rows. */
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<QuickFixPayloadV1 | null>(null);

  const generate = useCallback(async () => {
    if (!runId || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/engineer/quick-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = (await res.json().catch(() => ({}))) as QuickFixResponse;
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (!data.quickFix) {
        setError("No quick-fix payload returned.");
        return;
      }
      setPayload(data.quickFix);
    } catch {
      setError("Could not reach server — check connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [runId, loading]);

  const dashboardPrimaryClasses = "primary-action-chip-prominent w-full shrink-0 sm:w-auto";
  const compactPrimaryClasses = "primary-action-chip-compact shrink-0";

  return (
    <div className={cn("space-y-2", className)}>
      {!payload ? (
        <div className="space-y-1.5">
          <div className={cn(!compact && "flex flex-col sm:flex-row sm:justify-end")}>
            <button
              type="button"
              aria-label={loading ? undefined : "Improve my car"}
              className={primaryButtonClassName(
                cn(
                  compact ? compactPrimaryClasses : dashboardPrimaryClasses,
                  "disabled:opacity-60"
                )
              )}
              disabled={loading || !runId}
              onClick={() => void generate()}
            >
              {loading ? (
                "Generating…"
              ) : (
                <span className="primary-action-chip-content">
                  <span className="uppercase">IMPROVE MY CAR</span>
                  <EngineerNavIcon
                    className={cn(
                      "primary-action-chip-icon",
                      compact ? "h-3.5 w-3.5" : "h-4 w-4"
                    )}
                  />
                </span>
              )}
            </button>
          </div>
          {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
        </div>
      ) : (
        <EngineerQuickFixCard payload={payload} onDismiss={() => setPayload(null)} />
      )}
    </div>
  );
}
