import type { ReactNode } from "react";
import { BetweenRunRecentSessionsThings } from "@/components/betweenRunHints/BetweenRunRecentSessionsThings";
import type { BetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import {
  filterAvoidRepeatingForBetweenRunHints,
  pseudoSetupChangesFromSessionLines,
} from "@/lib/engineerPhase5/betweenRunHints/avoidRepeatingFilterForHints";
import { SectionMetaInline, SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/utils";

export function scopeLineFromHint(h: BetweenRunHintPayload): string {
  const bits = [h.scope.carLabel];
  if (h.scope.trackLabel) bits.push(h.scope.trackLabel);
  if (h.scope.eventLabel) bits.push(h.scope.eventLabel);
  return bits.join(" · ");
}

export function BetweenRunHintSummary({
  hint,
  title,
  actions,
  className,
}: {
  hint: BetweenRunHintPayload;
  /** Distinct from dashboard Try/Do lists — e.g. "Suggested next steps". */
  title: string;
  actions?: ReactNode;
  className?: string;
}) {
  const sessions = hint.recentSessions ?? [];
  const hasSessions = sessions.length > 0;
  const bullets = hint.bullets?.filter((b) => typeof b === "string" && b.trim().length > 0) ?? [];
  const headline = hint.headline?.trim() ?? "";
  const setupRows = pseudoSetupChangesFromSessionLines(sessions[0]?.setupChangesFromPrevious ?? []);
  const filteredAvoid = filterAvoidRepeatingForBetweenRunHints({
    text: hint.avoidRepeating,
    setupChanges: setupRows,
    headline,
    bullets,
  });
  const sources = hint.sourcesNote?.trim() ?? "";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <SectionTitle>{title}</SectionTitle>
        <SectionMetaInline>{scopeLineFromHint(hint)}</SectionMetaInline>
      </div>

      {headline ? (
        <p className="text-[13px] font-medium leading-snug text-foreground">{headline}</p>
      ) : null}

      {bullets.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-[12px] leading-snug text-foreground/95">
          {bullets.map((b, i) => (
            <li key={i} className="break-words">
              {b.trim()}
            </li>
          ))}
        </ul>
      ) : !headline ? (
        <p className="text-[11px] text-muted-foreground">
          Open Engineer for suggestions tied to your recent runs on this car.
        </p>
      ) : null}

      {sources ? (
        <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{sources}</p>
      ) : null}

      {hasSessions ? (
        <details className="rounded-md border border-border/80 bg-muted/20">
          <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground marker:text-muted-foreground">
            Recent session details ({sessions.length})
          </summary>
          <div className="border-t border-border/60 px-2 pb-2 pt-1">
            <BetweenRunRecentSessionsThings sessions={sessions} />
            {filteredAvoid ? (
              <p className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-snug text-foreground/90">
                <span className="font-medium text-foreground">Watch-out: </span>
                {filteredAvoid}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      {actions ? <div className="flex flex-wrap gap-2 pt-0.5">{actions}</div> : null}
    </div>
  );
}
