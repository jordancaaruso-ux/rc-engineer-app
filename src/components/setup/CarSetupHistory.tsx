"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import type { CarSetupHistoryEntry } from "@/lib/setup/carSetupHistory";

/**
 * Every setup this car has been through, newest first — the runs where the chassis actually
 * changed, and the sheets uploaded for it. Saved setups sit in their own card above; the
 * filter chips only appear once a car has both kinds, so a young car stays quiet.
 */

const MAX_CHIPS = 4;

type Filter = "all" | "run" | "sheet";

export function CarSetupHistory({
  entries,
  hasMore,
  truncated,
}: {
  entries: CarSetupHistoryEntry[];
  hasMore: boolean;
  truncated: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const hasRuns = entries.some((e) => e.kind === "run");
  const hasSheets = entries.some((e) => e.kind === "sheet");
  const showFilters = hasRuns && hasSheets;

  const shown = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.kind === filter)),
    [entries, filter]
  );

  if (entries.length === 0) {
    return (
      <div className="space-y-2">
        <div className="px-1">
          <Eyebrow>Setup history</Eyebrow>
        </div>
        <SurfaceCard variant="panel" contentClassName="text-sm text-muted-foreground">
          Nothing yet. Log a run or upload a setup sheet and every change to this car shows up here.
        </SurfaceCard>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <Eyebrow>Setup history</Eyebrow>
        <span className="ui-caption">Runs where the setup changed</span>
      </div>

      {showFilters ? (
        <div className="flex gap-1.5 overflow-x-auto px-0.5 pb-0.5">
          {(
            [
              ["all", "All"],
              ["run", "Runs"],
              ["sheet", "Sheets"],
            ] as Array<[Filter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
                filter === value
                  ? "border-accent/50 bg-accent/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <SurfaceCard variant="panel" contentClassName="p-0">
        <ul className="divide-y divide-border">
          {shown.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`}>
              <Link
                href={entry.href}
                prefetch={false}
                className="tap-active group flex items-start gap-3 px-4 py-3 transition hover:bg-muted/50"
              >
                <span className="w-11 shrink-0 pt-0.5 text-right font-mono text-[11px] leading-tight tabular-nums text-muted-foreground">
                  {entry.dateLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 rounded border border-border px-1 py-px text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      {entry.kind === "run" ? "Run" : "Sheet"}
                    </span>
                    <span className="truncate text-sm text-foreground">{entry.title}</span>
                  </span>
                  <span className="ui-caption mt-0.5 block truncate font-mono tabular-nums">
                    {entry.meta}
                  </span>
                  {entry.changedLabels.length > 0 ? (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {entry.changedLabels.slice(0, MAX_CHIPS).map((label) => (
                        <span
                          key={label}
                          className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
                        >
                          {label}
                        </span>
                      ))}
                      {entry.changedLabels.length > MAX_CHIPS ? (
                        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                          +{entry.changedLabels.length - MAX_CHIPS} more
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </SurfaceCard>

      {shown.length === 0 ? (
        <p className="ui-caption px-1">Nothing of that kind on this car yet.</p>
      ) : null}

      {hasMore || truncated ? (
        <p className="ui-caption px-1">
          Showing the {shown.length} most recent
          {truncated ? " of the last 200 runs considered" : ""}. Runs that changed nothing, or only
          tires and additive, are left out.
        </p>
      ) : (
        <p className="ui-caption px-1">
          Runs that changed nothing, or only tires and additive, are left out.
        </p>
      )}
    </div>
  );
}
