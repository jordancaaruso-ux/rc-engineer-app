"use client";

import { formatDistanceMeters } from "@/lib/location/trackProximity";

export function TrackNearbySuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: { trackId: string; trackName: string; distanceM: number }[];
  onSelect: (trackId: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-md border border-border/80 bg-muted/25 px-2.5 py-2 space-y-1.5">
      <p className="text-[11px] text-muted-foreground leading-snug">
        Nearby tracks — tap to select:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s.trackId}
            type="button"
            onClick={() => onSelect(s.trackId)}
            className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted/80 transition"
          >
            {s.trackName}{" "}
            <span className="text-muted-foreground font-normal">({formatDistanceMeters(s.distanceM)})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
