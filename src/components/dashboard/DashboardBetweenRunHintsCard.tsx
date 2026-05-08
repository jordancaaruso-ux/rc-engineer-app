import Link from "next/link";
import type { BetweenRunHintPayloadV1 } from "@/lib/engineerPhase5/betweenRunHints/betweenRunHintTypes";
import { cn } from "@/lib/utils";

function scopeLine(h: BetweenRunHintPayloadV1): string {
  const bits = [h.scope.carLabel];
  if (h.scope.trackLabel) bits.push(h.scope.trackLabel);
  if (h.scope.eventLabel) bits.push(h.scope.eventLabel);
  return bits.join(" · ");
}

export function DashboardBetweenRunHintsCard({
  hint,
  className,
}: {
  hint: BetweenRunHintPayloadV1 | null;
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
          <h2 className="text-sm font-semibold text-foreground">Next session — Engineer</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{scopeLine(hint)}</p>
        </div>
        <p className="text-sm font-medium text-foreground leading-snug">{hint.headline}</p>
        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
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
