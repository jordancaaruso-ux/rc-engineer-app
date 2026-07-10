"use client";

import {
  formatDrivingDuration,
  summaryChangeChip,
  type SummaryDelta,
} from "@/lib/dashboardSummary";
import { StatTile } from "@/components/ui/panel";
import { RollingNumber } from "@/components/ui/motion";

/**
 * A hero 30-day stat: the value rolls in on mount with a small NEUTRAL delta
 * chip beneath it. This is a client component on purpose — `RollingNumber` needs
 * a formatter function, which can't cross the server→client boundary, so the
 * formatter is chosen and owned here (client-side) from a plain `kind` string.
 *
 * Colour semantics: volume (runs, laps, wheel time) rising or falling is just a
 * different amount, never a win or loss, so the delta stays muted ink — green/red
 * is reserved for pace (see `DashboardSummaryCard`).
 */
export function DashboardMetricTile({
  label,
  value,
  delta,
  kind = "count",
}: {
  label: string;
  value: number;
  delta: SummaryDelta;
  /** "duration" renders seconds as wheel time ("2h 38m"); "count" is a plain integer. */
  kind?: "count" | "duration";
}) {
  const format =
    kind === "duration" ? formatDrivingDuration : (n: number) => String(Math.round(n));
  return (
    <StatTile
      label={label}
      className="py-2.5"
      value={
        <span className="flex flex-col gap-0.5">
          <RollingNumber value={value} format={format} />
          <DeltaChip delta={delta} formatDelta={format} />
        </span>
      }
    />
  );
}

/** Signed change vs the prior window, in neutral ink (volume is not gain/loss). */
function DeltaChip({
  delta,
  formatDelta,
}: {
  delta: SummaryDelta;
  formatDelta: (n: number) => string;
}) {
  const { diff, direction } = summaryChangeChip(delta);
  if (direction === "flat") {
    return <span className="text-[10px] font-normal text-muted-foreground">±0</span>;
  }
  return (
    <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
      {direction === "up" ? "↑" : "↓"} {formatDelta(Math.abs(diff))}
    </span>
  );
}
