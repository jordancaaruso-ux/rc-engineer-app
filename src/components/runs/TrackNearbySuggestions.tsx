"use client";

import { useUnits } from "@/components/providers/UnitsProvider";
import { formatDistance } from "@/lib/units/unitSystem";
import { cn } from "@/lib/utils";

export function TrackNearbySuggestions({
  suggestions,
  selectedId = null,
  onSelect,
}: {
  suggestions: { trackId: string; trackName: string; distanceM: number }[];
  /** The run's track when it is among these, drawn pressed (the layout chips' lit look). */
  selectedId?: string | null;
  onSelect: (trackId: string) => void;
}) {
  const units = useUnits();
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/80 bg-muted/25 px-2.5 py-2 space-y-1.5">
      <p className="text-[11px] text-muted-foreground leading-snug">
        Nearby
      </p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => {
          const selected = s.trackId === selectedId;
          return (
            <button
              key={s.trackId}
              type="button"
              onClick={() => onSelect(s.trackId)}
              aria-pressed={selected}
              className={cn(
                "flex min-h-7 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-medium text-foreground transition",
                selected ? "border-foreground/50 bg-muted" : "border-border bg-secondary hover:bg-muted"
              )}
            >
              {s.trackName}
              <span className="text-muted-foreground font-normal">({formatDistance(s.distanceM, units)})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
