import Link from "next/link";
import { BetweenRunRecentSessionsThings } from "@/components/betweenRunHints/BetweenRunRecentSessionsThings";
import type { BetweenRunHintPayload } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { cn } from "@/lib/utils";

function scopeLine(h: BetweenRunHintPayload): string {
  const bits = [h.scope.carLabel];
  if (h.scope.trackLabel) bits.push(h.scope.trackLabel);
  if (h.scope.eventLabel) bits.push(h.scope.eventLabel);
  return bits.join(" · ");
}

export function DashboardBetweenRunHintsCard({
  hint,
  className,
}: {
  hint: BetweenRunHintPayload | null;
  className?: string;
}) {
  if (!hint) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/80 p-4 shadow-sm",
        className
      )}
    >
      <div className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Things to consider — Engineer</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{scopeLine(hint)}</p>
        </div>
        <BetweenRunRecentSessionsThings sessions={hint.recentSessions ?? []} className="mt-2" />
        <div>
          <Link
            href={hint.engineerHref}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105"
          >
            Open Engineer
          </Link>
        </div>
      </div>
    </div>
  );
}
