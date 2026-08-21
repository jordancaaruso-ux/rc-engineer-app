"use client";

import { useState } from "react";
import Link from "next/link";
import { LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { HubRowTitle } from "@/components/ui/panel";
import { formatDistanceMeters } from "@/lib/location/trackProximity";

type NearbyTrack = {
  id: string;
  name: string;
  location?: string | null;
  distanceM: number;
};

/**
 * "Tracks near me" for the catalog page.
 *
 * The point of pre-seeding the catalog was that a driver standing at a track shouldn't have to
 * think — so the catalog needs a way to ask "what's around me" that doesn't involve knowing the
 * track's name. The measuring happens on the server (`/api/tracks/near`) because the catalog is
 * far too big to ship to the phone and measure there.
 *
 * Opt-in behind a tap rather than asking for location on page load: a permission prompt nobody
 * invited is the fastest way to get location denied for good, and a denial is sticky.
 */
export function TrackNearbyBrowse() {
  const [state, setState] = useState<"idle" | "locating" | "done" | "error">("idle");
  const [tracks, setTracks] = useState<NearbyTrack[]>([]);
  const [error, setError] = useState<string | null>(null);

  function findNearby() {
    haptic("light");
    setError(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("error");
      setError("This device can't share its location.");
      return;
    }

    setState("locating");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const params = new URLSearchParams({
            lat: String(position.coords.latitude),
            lon: String(position.coords.longitude),
          });
          const res = await fetch(`/api/tracks/near?${params}`, { cache: "no-store" });
          const data = (await res.json().catch(() => ({}))) as {
            tracks?: NearbyTrack[];
            error?: string;
          };
          if (!res.ok) {
            setState("error");
            setError(data.error ?? "Could not look up nearby tracks.");
            return;
          }
          setTracks(data.tracks ?? []);
          setState("done");
        } catch {
          setState("error");
          setError("Could not look up nearby tracks.");
        }
      },
      () => {
        setState("error");
        // Denial is the common case and it isn't a fault — say what still works.
        setError("Location is off for this site. Search by name instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    );
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={findNearby}
        className="tap-active flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
      >
        <LocateFixed className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
        <span className="font-medium">Find tracks near me</span>
      </button>
    );
  }

  if (state === "locating") {
    return (
      <p className="px-1 text-sm text-muted-foreground" role="status">
        Finding tracks near you…
      </p>
    );
  }

  if (state === "error") {
    return (
      <div className="px-1 text-sm text-muted-foreground" role="status">
        {error}{" "}
        <button type="button" onClick={findNearby} className="underline">
          Try again
        </button>
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground" role="status">
        No tracks within 50 km. Search by name, or add yours below.
      </p>
    );
  }

  return (
    <SurfaceCard variant="panel" contentClassName="p-0" overflowHidden={false}>
      <p className="px-4 pt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Near you</p>
      <ul className="divide-y divide-border">
        {tracks.map((t) => (
          <li key={t.id}>
            <Link
              href={`/tracks?trackId=${t.id}`}
              className={cn(
                "tap-active flex min-w-0 items-center gap-2 px-4 py-3 transition hover:bg-muted/50"
              )}
            >
              <span className="min-w-0 flex-1">
                <HubRowTitle as="span">{t.name}</HubRowTitle>
                {t.location ? (
                  <span className="ml-2 text-sm text-muted-foreground">({t.location})</span>
                ) : null}
              </span>
              <span className="shrink-0 fig-stat text-xs text-muted-foreground">
                {formatDistanceMeters(t.distanceM)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
