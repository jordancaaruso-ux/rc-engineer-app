"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Eyebrow, PanelSubtitle } from "@/components/ui/panel";
import { getCurrentPosition, GeolocationRequestError } from "@/lib/location/getCurrentPosition";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import {
  EMPTY_RUN_CONDITIONS,
  describeSky,
  type RunConditions,
} from "@/lib/weather/conditions";

type ConditionsTrack = {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
} | null;

type RunConditionsSectionProps = {
  value: RunConditions;
  onChange: (next: RunConditions) => void;
  track: ConditionsTrack;
  /** Best-known session time (ISO) for historical weather; null = fetch "now". */
  sessionAtIso: string | null;
  /** Persist device-resolved coordinates back onto the track's pin. */
  onSaveTrackPin?: (coords: { latitude: number; longitude: number }) => Promise<void> | void;
};

/** Sky override chips → representative WMO weather codes. */
const SKY_CHOICES: Array<{ label: string; code: number }> = [
  { label: "Clear", code: 0 },
  { label: "Mostly clear", code: 1 },
  { label: "Partly cloudy", code: 2 },
  { label: "Overcast", code: 3 },
  { label: "Rain", code: 63 },
];

function parseNumberInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmtField(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "";
}

const LABEL_CLASS = "block text-xs font-medium text-muted-foreground";
const INPUT_CLASS = "form-control w-full px-3 py-2 text-sm font-mono tabular-nums";

export function RunConditionsSection({
  value,
  onChange,
  track,
  sessionAtIso,
  onSaveTrackPin,
}: RunConditionsSectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinSaved, setPinSaved] = useState(false);
  const [deviceCoords, setDeviceCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const hasPin = trackHasMarkedLocation(track ?? {});

  const patch = useCallback(
    (partial: Partial<RunConditions>) => onChange({ ...value, ...partial }),
    [onChange, value]
  );

  const fetchFor = useCallback(
    async (coords: { latitude: number; longitude: number }, opts?: { silent?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          lat: String(coords.latitude),
          lon: String(coords.longitude),
        });
        if (sessionAtIso) params.set("at", sessionAtIso);
        const res = await fetch(`/api/weather?${params.toString()}`);
        const data = (await res.json()) as { conditions?: RunConditions; error?: string };
        if (!res.ok || !data.conditions) {
          throw new Error(data.error || "Weather lookup failed.");
        }
        // Preserve a manually entered track temp across a (re)fetch.
        onChange({ ...data.conditions, trackTempC: value.trackTempC });
      } catch (err) {
        if (!opts?.silent) {
          setError(err instanceof Error ? err.message : "Weather lookup failed.");
        }
      } finally {
        setLoading(false);
      }
    },
    [onChange, sessionAtIso, value.trackTempC]
  );

  const useDeviceLocation = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const pos = await getCurrentPosition();
      setDeviceCoords(pos);
      await fetchFor(pos);
    } catch (err) {
      if (err instanceof GeolocationRequestError) setError(err.message);
      else setError("Could not get your location.");
      setLoading(false);
    }
  }, [fetchFor]);

  const refetch = useCallback(() => {
    if (hasPin && track?.latitude && track?.longitude) {
      void fetchFor({ latitude: track.latitude, longitude: track.longitude });
    } else if (deviceCoords) {
      void fetchFor(deviceCoords);
    } else {
      void useDeviceLocation();
    }
  }, [hasPin, track, deviceCoords, fetchFor, useDeviceLocation]);

  const saveTrackPin = useCallback(async () => {
    if (!deviceCoords || !onSaveTrackPin) return;
    try {
      await onSaveTrackPin(deviceCoords);
      setPinSaved(true);
    } catch {
      setError("Couldn't save the track location.");
    }
  }, [deviceCoords, onSaveTrackPin]);

  const clearAll = useCallback(() => {
    setDeviceCoords(null);
    setPinSaved(false);
    setError(null);
    onChange({ ...EMPTY_RUN_CONDITIONS });
  }, [onChange]);

  const sky = describeSky(value.weatherCode, value.cloudCoverPct);
  const observed =
    value.observedAtIso && !Number.isNaN(new Date(value.observedAtIso).getTime())
      ? new Date(value.observedAtIso)
      : null;
  const sourceLabel =
    value.source === "open-meteo-forecast" || value.source === "open-meteo-archive"
      ? "Open-Meteo"
      : value.source === "manual"
        ? "Manual"
        : null;

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1.5">
          <Eyebrow dot="muted">Conditions</Eyebrow>
          <PanelSubtitle>
            Weather at the session — auto-filled from the track location, editable.
          </PanelSubtitle>
        </div>
        {loading ? (
          <span className="type-data-label text-faint">Fetching…</span>
        ) : null}
      </div>

      {/* Fetch controls */}
      <div className="flex flex-wrap items-center gap-2">
        {hasPin ? (
          <Button variant="outline" onClick={refetch} disabled={loading} className="text-xs">
            {value.airTempC != null ? "Refresh" : "Get conditions"}
          </Button>
        ) : (
          <Button variant="outline" onClick={useDeviceLocation} disabled={loading} className="text-xs">
            Use my location
          </Button>
        )}
        {!hasPin && deviceCoords && onSaveTrackPin && track ? (
          pinSaved ? (
            <span className="type-data-label text-[var(--color-gain,#4FD089)]">Saved to {track.name}</span>
          ) : (
            <button
              type="button"
              onClick={saveTrackPin}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Save as {track.name}&rsquo;s location
            </button>
          )
        ) : null}
        {(value.airTempC != null || value.source) && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {!hasPin && !track ? (
        <PanelSubtitle>Pick a track above, or use your location, to pull conditions.</PanelSubtitle>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}

      {/* Primary: air temp + sky */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="cond-air-temp" className={LABEL_CLASS}>
            Air temp (°C)
          </label>
          <input
            id="cond-air-temp"
            type="text"
            inputMode="decimal"
            value={fmtField(value.airTempC)}
            onChange={(e) => patch({ airTempC: parseNumberInput(e.target.value) })}
            placeholder="—"
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="cond-track-temp" className={LABEL_CLASS}>
            Track temp (°C)
          </label>
          <input
            id="cond-track-temp"
            type="text"
            inputMode="decimal"
            value={fmtField(value.trackTempC)}
            onChange={(e) => patch({ trackTempC: parseNumberInput(e.target.value) })}
            placeholder="probe"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      {/* Sky */}
      <div className="space-y-1.5">
        <span className={LABEL_CLASS}>Sky{sky ? ` · ${sky.label}` : ""}</span>
        <div className="flex flex-wrap gap-1.5">
          {SKY_CHOICES.map((choice) => {
            const active = value.weatherCode === choice.code;
            return (
              <button
                key={choice.code}
                type="button"
                onClick={() => patch({ weatherCode: choice.code })}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Secondary: humidity + wind */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="cond-humidity" className={LABEL_CLASS}>
            Humidity (%)
          </label>
          <input
            id="cond-humidity"
            type="text"
            inputMode="numeric"
            value={fmtField(value.humidityPct)}
            onChange={(e) => patch({ humidityPct: parseNumberInput(e.target.value) })}
            placeholder="—"
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="cond-wind" className={LABEL_CLASS}>
            Wind (km/h)
          </label>
          <input
            id="cond-wind"
            type="text"
            inputMode="decimal"
            value={fmtField(value.windKph)}
            onChange={(e) => patch({ windKph: parseNumberInput(e.target.value) })}
            placeholder="—"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      {sourceLabel ? (
        <p className="type-timestamp text-faint">
          {sourceLabel}
          {observed
            ? ` · ${observed.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
