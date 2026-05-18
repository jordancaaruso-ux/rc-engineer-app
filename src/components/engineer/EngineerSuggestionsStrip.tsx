"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { DashboardEngineerSuggestionPayloadV1 } from "@/lib/engineerPhase5/dashboardSuggestions/dashboardSuggestionTypes";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/utils";

/**
 * Top-of-page strip on `/engineer` — same dashboard Engineer suggestions payload as the home hero
 * (`/api/engineer/dashboard-suggestions`), anchored to URL `runId` when present, otherwise latest eligible run.
 */
export function EngineerSuggestionsStrip({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId")?.trim() || "";

  const [suggestions, setSuggestions] = useState<DashboardEngineerSuggestionPayloadV1 | null | undefined>(
    undefined
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSuggestions(undefined);
    setError(null);

    const qs = new URLSearchParams();
    qs.set("sync", "1");
    if (runId) qs.set("runId", runId);
    else qs.set("latest", "1");

    void fetch(`/api/engineer/dashboard-suggestions?${qs.toString()}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          suggestions?: DashboardEngineerSuggestionPayloadV1 | null;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Could not load suggestions");
          setSuggestions(null);
          return;
        }
        if (cancelled) return;
        setSuggestions(data.suggestions ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load suggestions");
          setSuggestions(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (suggestions === undefined && !error) {
    return (
      <HeroPanel variant="muted" className={cn("text-xs text-muted-foreground", className)}>
        Loading engineer suggestions…
      </HeroPanel>
    );
  }

  if (error || !suggestions) {
    return null;
  }

  return (
    <HeroPanel className={cn(className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0 flex-1 space-y-2 text-[11px] leading-snug">
          <SectionTitle as="div" className="text-sm">
            Engineer suggestions
          </SectionTitle>
          <p className="font-medium text-foreground">{suggestions.headline}</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {suggestions.bullets.map((b, i) => (
              <li key={i} className="break-words">
                {b}
              </li>
            ))}
          </ul>
          {suggestions.tryNextSession.length > 0 ? (
            <div className="rounded-md border border-border/80 bg-muted/30 px-2 py-1.5">
              <div className="ui-title text-[10px] text-muted-foreground mb-1">Next session</div>
              <ul className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
                {suggestions.tryNextSession.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-[10px] text-muted-foreground">{suggestions.sourcesNote}</p>
        </div>
        <ButtonLink href={suggestions.engineerHref} variant="outline" className="shrink-0 self-start">
          Focus in Engineer
        </ButtonLink>
      </div>
    </HeroPanel>
  );
}
