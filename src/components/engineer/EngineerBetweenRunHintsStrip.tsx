"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BetweenRunRecentSessionsThings } from "@/components/betweenRunHints/BetweenRunRecentSessionsThings";
import type { BetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { SectionMetaInline, SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/utils";

function scopeLine(h: BetweenRunHintPayload): string {
  const bits = [h.scope.carLabel];
  if (h.scope.trackLabel) bits.push(h.scope.trackLabel);
  if (h.scope.eventLabel) bits.push(h.scope.eventLabel);
  return bits.join(" · ");
}

export function EngineerBetweenRunHintsStrip({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId")?.trim() || "";

  const [hint, setHint] = useState<BetweenRunHintPayload | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHint(undefined);
    setError(null);

    const qs = new URLSearchParams();
    if (runId) qs.set("runId", runId);
    qs.set("sync", "1");

    void fetch(`/api/engineer/between-run-hints?${qs.toString()}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { hint?: BetweenRunHintPayload | null; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not load hints");
          setHint(null);
          return;
        }
        if (cancelled) return;
        setHint(data.hint ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load hints");
          setHint(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (hint === undefined && !error) {
    return (
      <HeroPanel variant="muted" className={cn("text-xs text-muted-foreground", className)}>
        Loading things to try…
      </HeroPanel>
    );
  }

  if (error || !hint) {
    return null;
  }

  const sessions = hint.recentSessions ?? [];

  return (
    <HeroPanel className={cn(className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <SectionTitle>Things to try</SectionTitle>
            <SectionMetaInline>{scopeLine(hint)}</SectionMetaInline>
          </div>

          <BetweenRunRecentSessionsThings sessions={sessions} />
        </div>
        <ButtonLink href={hint.engineerHref} variant="outline" className="shrink-0">
          Focus in Engineer
        </ButtonLink>
      </div>
    </HeroPanel>
  );
}
