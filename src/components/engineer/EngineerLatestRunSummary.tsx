"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineerRunSummaryPanel } from "@/components/engineer/EngineerRunSummaryPanel";

/**
 * Deterministic engineer summary for the latest run (or URL-focused run when ?runId= is set).
 */
export function EngineerLatestRunSummary() {
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams.get("runId")?.trim() || null;
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const panelRunId = runIdFromUrl ?? runId;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    if (runIdFromUrl) {
      setRunId(runIdFromUrl);
      setLoading(false);
      return () => {
        alive = false;
      };
    }
    fetch("/api/engineer/summary", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((data: { runId?: string | null }) => {
        if (!alive) return;
        setRunId(typeof data.runId === "string" ? data.runId : null);
      })
      .catch(() => {
        if (alive) setRunId(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [runIdFromUrl]);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground tracking-tight">Latest run summary</h2>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Deterministic summary vs your previous run on the same car. Open a run from history with the Engineer link to
        focus chat on that run.
      </p>
      {loading && !runIdFromUrl ? (
        <div className="rounded-lg border border-border bg-muted/40 p-6 text-sm text-muted-foreground text-center">
          Loading summary…
        </div>
      ) : panelRunId ? (
        <EngineerRunSummaryPanel runId={panelRunId} />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground text-center">
          No runs yet. Log a run to see your engineer summary here.
        </div>
      )}
    </section>
  );
}
