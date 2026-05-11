"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BetweenRunHintSummary } from "@/components/betweenRunHints/BetweenRunHintSummary";
import type { BetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { cn } from "@/lib/utils";

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
        Loading between-run hints…
      </HeroPanel>
    );
  }

  if (error || !hint) {
    return null;
  }

  return (
    <HeroPanel className={cn(className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <BetweenRunHintSummary hint={hint} title="Suggested next steps" className="min-w-0 flex-1" />
        <ButtonLink href={hint.engineerHref} variant="outline" className="shrink-0 self-start">
          Focus in Engineer
        </ButtonLink>
      </div>
    </HeroPanel>
  );
}
