"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { BetweenRunHintPayloadV1 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { cn } from "@/lib/utils";

function scopeLine(h: BetweenRunHintPayloadV1): string {
  const bits = [h.scope.carLabel];
  if (h.scope.trackLabel) bits.push(h.scope.trackLabel);
  if (h.scope.eventLabel) bits.push(h.scope.eventLabel);
  return bits.join(" · ");
}

export function EngineerBetweenRunHintsStrip({ className }: { className?: string }) {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId")?.trim() || "";

  const [hint, setHint] = useState<BetweenRunHintPayloadV1 | null | undefined>(undefined);
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
        const data = (await res.json().catch(() => ({}))) as { hint?: BetweenRunHintPayloadV1 | null; error?: string };
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
      <div
        className={cn(
          "rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground",
          className
        )}
      >
        Loading next-session hints…
      </div>
    );
  }

  if (error || !hint) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 shadow-sm",
        className
      )}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">Next session</h2>
            <span className="text-[11px] text-muted-foreground">{scopeLine(hint)}</span>
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">{hint.headline}</p>
          <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
            {hint.bullets.slice(0, 4).map((b, i) => (
              <li key={i} className="leading-snug">
                {b}
              </li>
            ))}
          </ul>
          {hint.avoidRepeating ? (
            <p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-xs text-foreground leading-snug">
              {hint.avoidRepeating}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground leading-snug">{hint.sourcesNote}</p>
        </div>
        <Link
          href={hint.engineerHref}
          className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted/60"
        >
          Focus in Engineer
        </Link>
      </div>
    </div>
  );
}
