"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import { parseCoordinatesPaste } from "@/lib/location/parseCoordinatesPaste";
import { getCurrentPosition, GeolocationRequestError } from "@/lib/location/getCurrentPosition";

export type TrackLocationFields = {
  latitude?: number | null;
  longitude?: number | null;
  locationSource?: string | null;
};

function googleMapsSearchUrl(trackName: string, location?: string | null): string {
  const q = [trackName, location?.trim()].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function TrackLocationEditor({
  trackId,
  trackName,
  location,
  initial,
  compact = false,
  showCurrentLocation = true,
  onSaved,
}: {
  trackId: string;
  trackName: string;
  location?: string | null;
  initial: TrackLocationFields;
  compact?: boolean;
  showCurrentLocation?: boolean;
  onSaved?: (track: TrackLocationFields) => void;
}) {
  const [coordsPaste, setCoordsPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(initial);

  const hasGps = trackHasMarkedLocation(saved);

  async function patchLocation(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        track?: TrackLocationFields;
      };
      if (!res.ok) {
        setError(data.error ?? `Could not save (${res.status})`);
        return;
      }
      if (data.track) {
        setSaved(data.track);
        onSaved?.(data.track);
      }
      setCoordsPaste("");
    } finally {
      setBusy(false);
    }
  }

  async function savePaste() {
    const parsed = parseCoordinatesPaste(coordsPaste);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    await patchLocation({
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      locationSource: "manual_paste",
    });
  }

  async function saveCurrentLocation() {
    try {
      const position = await getCurrentPosition();
      await patchLocation({
        latitude: position.latitude,
        longitude: position.longitude,
        locationSource: "device",
      });
    } catch (e) {
      if (e instanceof GeolocationRequestError) setError(e.message);
      else setError(e instanceof Error ? e.message : "Could not get location");
    }
  }

  return (
    <div className={cn("space-y-3", compact ? "text-xs" : "text-sm")}>
      {hasGps ? (
        <p className="text-muted-foreground leading-snug">
          GPS set:{" "}
          <span className="font-mono text-foreground">
            {saved.latitude!.toFixed(5)}, {saved.longitude!.toFixed(5)}
          </span>
          {saved.locationSource ? (
            <span className="text-[10px] ml-1">({saved.locationSource})</span>
          ) : null}
        </p>
      ) : (
        <p className="text-muted-foreground leading-snug">
          In Google Maps, find the track, right-click the pin, and copy the coordinates. Paste them below
          (e.g. -37.75, 145.13). You can set this before you visit.
        </p>
      )}

      <div className="space-y-1">
        <label className="block text-[11px] text-muted-foreground">Coordinates (latitude, longitude)</label>
        <input
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono outline-none"
          value={coordsPaste}
          onChange={(e) => setCoordsPaste(e.target.value)}
          placeholder="-37.75347, 145.13890"
          disabled={busy}
        />
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !coordsPaste.trim()}
          className={cn(
            "rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-xs font-medium hover:bg-accent/25 transition",
            (busy || !coordsPaste.trim()) && "opacity-60 pointer-events-none"
          )}
          onClick={() => void savePaste()}
        >
          {busy ? "Saving…" : "Save coordinates"}
        </button>
        {showCurrentLocation ? (
          <button
            type="button"
            disabled={busy}
            className={cn(
              "rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/80 transition",
              busy && "opacity-60 pointer-events-none"
            )}
            onClick={() => void saveCurrentLocation()}
          >
            Use current location
          </button>
        ) : null}
        <a
          href={googleMapsSearchUrl(trackName, location)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground transition"
        >
          Search on Google Maps
        </a>
      </div>
    </div>
  );
}
