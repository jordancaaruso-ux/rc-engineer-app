import { Disc } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatTireIndicatorTitle,
  type RunTireIndicator,
} from "@/lib/runs/tireSetChange";

/**
 * Tire state at a glance for a run row: Disc icon with the set's run count in
 * the corner ("1" = new set). Bright when the set changed vs the previous
 * same-car run, faint when it's the same set still going. Purely
 * informational — never a button.
 */
export function TireIndicatorIcon({
  indicator,
  size = "md",
  className,
}: {
  indicator: RunTireIndicator;
  /** md = 32px slot (mobile rows / cards); sm = 24px slot (desktop table rows). */
  size?: "sm" | "md";
  className?: string;
}) {
  const title = formatTireIndicatorTitle(indicator);
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        size === "md" ? "h-8 w-8" : "h-6 w-6",
        indicator.changed ? "text-foreground" : "text-faint",
        className
      )}
    >
      <Disc className="h-4 w-4" aria-hidden />
      {indicator.runNumber != null ? (
        <span
          className={cn(
            "absolute font-mono tabular-nums leading-none text-[8px]",
            size === "md" ? "bottom-1 right-1" : "bottom-0 right-0",
            indicator.changed ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {indicator.runNumber}
        </span>
      ) : null}
    </span>
  );
}
