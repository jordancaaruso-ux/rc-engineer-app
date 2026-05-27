"use client";

import { useSearchParams } from "next/navigation";
import { EngineerSuggestionsCard } from "@/components/engineer/EngineerSuggestionsCard";
import { cn } from "@/lib/utils";

/**
 * Top-of-page strip on `/engineer` — on-demand dashboard Engineer suggestions.
 * Anchored to URL `runId` when present, otherwise latest eligible run (peek only).
 */
export function EngineerSuggestionsStrip({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId")?.trim() || undefined;

  return (
    <EngineerSuggestionsCard
      runId={runId}
      useLatest={!runId}
      layout="standalone"
      className={cn(className)}
    />
  );
}
