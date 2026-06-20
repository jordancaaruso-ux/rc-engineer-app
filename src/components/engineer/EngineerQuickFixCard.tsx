"use client";

import type { QuickFixPayloadV1 } from "@/lib/engineerPhase5/quickFix/quickFixTypes";
import { magnitudeTierLabel } from "@/lib/engineerPhase5/quickFix/quickFixMagnitude";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

const CONFIDENCE_CLASS: Record<string, string> = {
  high: "text-gain",
  medium: "text-muted-foreground",
  low: "text-faint",
};

export function EngineerQuickFixCard({
  payload,
  className,
  onDismiss,
}: {
  payload: QuickFixPayloadV1;
  className?: string;
  onDismiss?: () => void;
}) {
  return (
    <div className={cn("space-y-2.5 rounded-lg border border-border/80 bg-muted/25 px-3 py-2.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <Eyebrow dot="accent">Quick fix</Eyebrow>
        {onDismiss ? (
          <button
            type="button"
            className="tap-active text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">
        For <span className="font-medium text-foreground">{payload.runLabel}</span>
      </p>

      <p className="text-[11px] leading-snug text-muted-foreground">{payload.magnitudeNote}</p>
      {payload.inferredIssue ? (
        <p className="text-[11px] font-medium text-foreground">Issue: {payload.inferredIssue}</p>
      ) : null}

      <ol className="list-decimal space-y-2 pl-4 text-[11px] leading-snug">
        {payload.suggestions.map((s, i) => (
          <li key={`${s.parameter}-${s.priority}-${i}`} className="break-words">
            <span className="font-medium text-foreground">
              {s.parameter}
            </span>
            {" — "}
            <span className="text-foreground">{s.direction}</span>
            {s.amount ? <span className="text-muted-foreground"> ({s.amount})</span> : null}
            <p className="mt-0.5 text-muted-foreground">{s.kbWhy}</p>
            <p className="mt-0.5 text-muted-foreground">
              <span className={CONFIDENCE_CLASS[s.confidence] ?? ""}>{s.confidence} confidence</span>
              {" · "}
              {s.expectedEffect}
            </p>
          </li>
        ))}
      </ol>

      <p className="text-[10px] text-muted-foreground">
        Move size: {magnitudeTierLabel(payload.magnitudeTier)}. {payload.thinContextNote}
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <ButtonLink href={payload.engineerHref} variant="outline" className="text-[11px]">
          Dig deeper
        </ButtonLink>
        <span className="text-[10px] text-faint">Uses AI · KB-grounded</span>
      </div>
    </div>
  );
}
