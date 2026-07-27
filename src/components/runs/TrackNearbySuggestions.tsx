"use client";

import { formatDistanceMeters } from "@/lib/location/trackProximity";

export function TrackNearbySuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: { trackId: string; trackName: string; distanceM: number; isFavourite?: boolean }[];
  onSelect: (trackId: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/80 bg-muted/25 px-2.5 py-2 space-y-1.5">
      <p className="text-[11px] text-muted-foreground leading-snug">
        Nearby tracks — tap to select (favourites first):
      </p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s.trackId}
            type="button"
            onClick={() => onSelect(s.trackId)}
            className="flex min-h-7 items-center gap-1 rounded-lg border border-border bg-secondary px-2.5 text-[11px] font-medium text-foreground transition hover:bg-muted"
          >
            {s.isFavourite ? (
              <span className="text-primary" aria-hidden>
                ★
              </span>
            ) : null}
            {s.trackName}
            <span className="text-muted-foreground font-normal">({formatDistanceMeters(s.distanceM)})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
