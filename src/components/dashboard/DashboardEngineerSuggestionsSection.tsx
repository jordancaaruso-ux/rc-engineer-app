"use client";

import type { DashboardEngineerSuggestionPayloadV1 } from "@/lib/engineerPhase5/dashboardSuggestions/dashboardSuggestionTypes";
import { DashboardEngineerSuggestionsPanel } from "@/components/dashboard/DashboardEngineerSuggestionsPanel";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { SectionMetaInline, SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/utils";

function scopeLine(carName: string, trackName: string | null, eventName: string | null): string {
  const bits = [carName];
  if (trackName) bits.push(trackName);
  if (eventName) bits.push(eventName);
  return bits.join(" · ");
}

/**
 * Dashboard hero “Engineer suggestions” — same `/api/engineer/dashboard-suggestions` pipeline
 * as before on the Last run card, with optional SSR peek via `initialSuggestions`.
 */
export function DashboardEngineerSuggestionsSection({
  initialSuggestions,
  primaryRunId,
  carName,
  trackName,
  eventName,
  className,
}: {
  initialSuggestions: DashboardEngineerSuggestionPayloadV1 | null;
  primaryRunId: string | null;
  carName: string;
  trackName: string | null;
  eventName: string | null;
  className?: string;
}) {
  if (!primaryRunId) return null;

  return (
    <HeroPanel className={cn(className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <SectionTitle as="div" className="text-sm">
          Engineer suggestions
        </SectionTitle>
        <SectionMetaInline>{scopeLine(carName, trackName, eventName)}</SectionMetaInline>
      </div>
      <div className="mt-2">
        <DashboardEngineerSuggestionsPanel runId={primaryRunId} initialSuggestions={initialSuggestions} />
      </div>
    </HeroPanel>
  );
}
