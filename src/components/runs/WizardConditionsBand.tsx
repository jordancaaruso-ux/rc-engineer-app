"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/ui/panel";
import { getCurrentPosition, GeolocationRequestError } from "@/lib/location/getCurrentPosition";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import { describeSky, formatTempC, type RunConditions } from "@/lib/weather/conditions";

type BandTrack = {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
} | null;

type WizardConditionsBandProps = {
  track: BandTrack;
  /** Track temp as held by the form — the ONE conditions field this band owns. */
  trackTempC: number | null;
  onTrackTempChange: (next: number | null) => void;
  /**
   * A reading already stored on this run (resumed draft / edit). When present the
   * band shows it instead of fetching — never re-look-up a past session's weather.
   */
  storedConditions?: RunConditions | null;
  /** Persist device-resolved coordinates onto the track's pin. */
  onSaveTrackPin?: (coords: { latitude: number; longitude: number }) => Promise<void> | void;
};

type Phase = "idle" | "loading" | "ready" | "failed";

function parseTempInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmtTempField(n: number | null): string {
  return typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "";
}

/** The reading, spelled out: air temp · sky · humidity · wind. */
function readoutLine(c: RunConditions): string | null {
  const parts: string[] = [];
  const temp = formatTempC(c.airTempC);
  if (temp) parts.push(temp);
  const sky = describeSky(c.weatherCode, c.cloudCoverPct);
  if (sky) parts.push(sky.label);
  if (c.humidityPct != null) parts.push(`${Math.round(c.humidityPct)}%`);
  if (c.windKph != null) parts.push(`${Math.round(c.windKph)} km/h`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Log-run wizard, step one: says out loud that the weather logs itself, shows the
 * reading once it lands, and carries the one number no lookup can know — track
 * temp off the driver's probe.
 *
 * The reading shown here is a PREVIEW and is deliberately never lifted into the
 * form's conditions. The run's stored weather is still fetched at Run complete,
 * for the session window the car was actually on track (founder decision
 * 2026-07-16). Only `trackTempC` is lifted.
 */
export function WizardConditionsBand({
  track,
  trackTempC,
  onTrackTempChange,
  storedConditions,
  onSaveTrackPin,
}: WizardConditionsBandProps) {
  const [preview, setPreview] = useState<RunConditions | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [deviceCoords, setDeviceCoords] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [pinSaved, setPinSaved] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);

  const hasPin = trackHasMarkedLocation(track ?? {});
  const stored = storedConditions ?? null;
  const storedLine = stored ? readoutLine(stored) : null;

  const fetchFor = useCallback(
    async (coords: { latitude: number; longitude: number }, key: string) => {
      fetchedKeyRef.current = key;
      setPhase("loading");
      try {
        const params = new URLSearchParams({
          lat: String(coords.latitude),
          lon: String(coords.longitude),
        });
        const res = await fetch(`/api/weather?${params.toString()}`);
        const data = (await res.json()) as { conditions?: RunConditions };
        if (!res.ok || !data.conditions) throw new Error("lookup failed");
        setPreview(data.conditions);
        setPhase("ready");
      } catch {
        // Weather is a bonus, never a chore: a failure is a grey line, not an error.
        setPhase("failed");
      }
    },
    []
  );

  // Pinned track selected → preview it. No permission prompt: the coordinates
  // are already the track's. A stored reading wins outright.
  useEffect(() => {
    if (storedLine) return;
    if (!track || !hasPin || track.latitude == null || track.longitude == null) return;
    const key = `${track.id}:${track.latitude.toFixed(3)},${track.longitude.toFixed(3)}`;
    if (fetchedKeyRef.current === key) return;
    void fetchFor({ latitude: track.latitude, longitude: track.longitude }, key);
  }, [storedLine, track, hasPin, fetchFor]);

  const requestDeviceLocation = useCallback(async () => {
    setLocationError(null);
    setPhase("loading");
    try {
      const pos = await getCurrentPosition();
      setDeviceCoords(pos);
      await fetchFor(pos, `device:${pos.latitude.toFixed(3)},${pos.longitude.toFixed(3)}`);
    } catch (err) {
      setLocationError(
        err instanceof GeolocationRequestError ? err.message : "Couldn't get your location."
      );
      setPhase("idle");
    }
  }, [fetchFor]);

  const retry = useCallback(() => {
    fetchedKeyRef.current = null;
    if (track && hasPin && track.latitude != null && track.longitude != null) {
      void fetchFor(
        { latitude: track.latitude, longitude: track.longitude },
        `${track.id}:${track.latitude.toFixed(3)},${track.longitude.toFixed(3)}`
      );
    } else if (deviceCoords) {
      void fetchFor(
        deviceCoords,
        `device:${deviceCoords.latitude.toFixed(3)},${deviceCoords.longitude.toFixed(3)}`
      );
    } else {
      void requestDeviceLocation();
    }
  }, [track, hasPin, deviceCoords, fetchFor, requestDeviceLocation]);

  const saveTrackPin = useCallback(async () => {
    if (!deviceCoords || !onSaveTrackPin) return;
    try {
      await onSaveTrackPin(deviceCoords);
      setPinSaved(true);
    } catch {
      setLocationError("Couldn't save the track location.");
    }
  }, [deviceCoords, onSaveTrackPin]);

  const previewLine = preview ? readoutLine(preview) : null;
  const line = storedLine ?? previewLine;
  const loading = phase === "loading";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow dot="muted">Conditions</Eyebrow>
        {loading ? (
          <span className="type-timestamp text-faint inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--color-primary-ink))] motion-safe:animate-pulse"
            />
            Fetching…
          </span>
        ) : line ? (
          <span className="type-timestamp text-faint">
            {storedLine ? "Logged" : "Logging automatically"}
          </span>
        ) : phase === "failed" ? (
          <button
            type="button"
            onClick={retry}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Try again
          </button>
        ) : null}
      </div>

      {loading && !line ? (
        <div
          aria-hidden
          className="h-4 w-3/5 rounded bg-border/70 motion-safe:animate-pulse"
        />
      ) : line ? (
        <>
          <p className="fig-stat text-sm text-foreground">{line}</p>
          {storedLine ? null : (
            <p className="type-timestamp text-faint">
              Checked again when you finish, for the minutes you ran.
            </p>
          )}
        </>
      ) : phase === "failed" ? (
        <p className="text-xs text-muted-foreground">
          Couldn&rsquo;t reach the weather just now — it tries again when you finish the run.
        </p>
      ) : !track ? (
        <p className="text-xs text-muted-foreground">Pick a track and the weather logs itself.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {track.name} has no location saved, so the weather can&rsquo;t be looked up.
          </p>
          <button
            type="button"
            onClick={requestDeviceLocation}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:border-foreground/30"
          >
            Use my location
          </button>
        </div>
      )}

      {deviceCoords && onSaveTrackPin && track && !hasPin ? (
        pinSaved ? (
          <p className="type-timestamp text-faint">Saved to {track.name}</p>
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

      {locationError ? <p className="text-xs text-muted-foreground">{locationError}</p> : null}

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
        <label htmlFor="wizard-track-temp" className="flex flex-col leading-tight">
          <span className="text-[13px] font-medium text-foreground">Track temp</span>
          <span className="type-timestamp text-faint">If you&rsquo;ve probed it</span>
        </label>
        <div className="relative w-24 shrink-0">
          <input
            id="wizard-track-temp"
            type="text"
            inputMode="decimal"
            value={fmtTempField(trackTempC)}
            onChange={(e) => onTrackTempChange(parseTempInput(e.target.value))}
            placeholder="—"
            aria-label="Track temp in degrees Celsius"
            className="form-control w-full py-2 pl-3 pr-7 fig-stat"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint"
          >
            °C
          </span>
        </div>
      </div>
    </div>
  );
}
