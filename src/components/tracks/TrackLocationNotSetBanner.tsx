"use client";

import { useState } from "react";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import { TrackLocationEditor, type TrackLocationFields } from "@/components/tracks/TrackLocationEditor";

export function TrackLocationNotSetBanner({
  trackId,
  trackName,
  location,
  initial,
  showCurrentLocation = true,
  onSaved,
}: {
  trackId: string;
  trackName: string;
  location?: string | null;
  initial: TrackLocationFields;
  showCurrentLocation?: boolean;
  onSaved?: (track: TrackLocationFields) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [coords, setCoords] = useState(initial);

  if (trackHasMarkedLocation(coords)) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-amber-900 dark:text-amber-200">
          GPS location not set ·{" "}
          <button
            type="button"
            className="font-medium underline underline-offset-2 hover:no-underline"
            onClick={() => setExpanded((v) => !v)}
          >
            Set location
          </button>
        </span>
      </div>
      {expanded ? (
        <div className="mt-3 border-t border-amber-500/30 pt-3">
          <TrackLocationEditor
            trackId={trackId}
            trackName={trackName}
            location={location}
            initial={coords}
            compact
            showCurrentLocation={showCurrentLocation}
            onSaved={(t) => {
              setCoords(t);
              onSaved?.(t);
              if (trackHasMarkedLocation(t)) setExpanded(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
