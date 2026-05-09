"use client";

import { useEffect, useState } from "react";
import type { BetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { DashboardBetweenRunHintsCard } from "@/components/dashboard/DashboardBetweenRunHintsCard";
import { cn } from "@/lib/utils";

/**
 * SSR passes a peek-cached hint when available; when missing, the client sync-fetches
 * so the card appears without a full page refresh after background compute.
 */
export function DashboardBetweenRunHintsSection({
  initialHint,
  primaryRunId,
  className,
}: {
  initialHint: BetweenRunHintPayload | null;
  primaryRunId: string | null;
  className?: string;
}) {
  const [hint, setHint] = useState<BetweenRunHintPayload | null>(initialHint);
  const [loading, setLoading] = useState(() => Boolean(primaryRunId && initialHint == null));

  useEffect(() => {
    setHint(initialHint);
  }, [initialHint]);

  useEffect(() => {
    if (!primaryRunId) {
      setLoading(false);
      return;
    }
    if (initialHint) {
      setLoading(false);
      setHint(initialHint);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const qs = new URLSearchParams();
    qs.set("runId", primaryRunId);
    qs.set("sync", "1");

    void fetch(`/api/engineer/between-run-hints?${qs}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { hint?: BetweenRunHintPayload | null };
        if (cancelled) return;
        setHint(data.hint ?? null);
      })
      .catch(() => {
        if (!cancelled) setHint(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [primaryRunId, initialHint]);

  if (!primaryRunId) return null;

  if (loading) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground",
          className
        )}
      >
        Loading things to consider…
      </div>
    );
  }

  return <DashboardBetweenRunHintsCard hint={hint} className={className} />;
}
