"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EngineerSuggestionsCard } from "@/components/engineer/EngineerSuggestionsCard";
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
 * Dashboard hero “Engineer suggestions” — on-demand peek / generate via shared card.
 */
export function DashboardEngineerSuggestionsSection({
  primaryRunId,
  carName,
  trackName,
  eventName,
  className,
}: {
  primaryRunId: string | null;
  carName: string;
  trackName: string | null;
  eventName: string | null;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const suggestRun = searchParams.get("suggestRun")?.trim() || null;

  const clearPostRunPrompt = useCallback(() => {
    if (suggestRun) router.replace("/", { scroll: false });
  }, [router, suggestRun]);

  if (!primaryRunId) return null;

  const emphasis = suggestRun === primaryRunId ? ("postRun" as const) : ("default" as const);

  return (
    <HeroPanel className={cn(className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <SectionTitle as="div" className="text-sm">
          Engineer suggestions
        </SectionTitle>
        <SectionMetaInline>{scopeLine(carName, trackName, eventName)}</SectionMetaInline>
      </div>
      <div className="mt-2">
        <EngineerSuggestionsCard
          runId={primaryRunId}
          emphasis={emphasis}
          layout="embedded"
          onClearPostRunPrompt={clearPostRunPrompt}
        />
      </div>
    </HeroPanel>
  );
}
