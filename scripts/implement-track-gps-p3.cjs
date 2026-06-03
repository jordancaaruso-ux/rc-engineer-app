const fs = require("fs");
const trackList = `"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import { TrackLocationNotSetBanner } from "@/components/tracks/TrackLocationNotSetBanner";

type Track = {
  id: string;
  name: string;
  location?: string | null;
  liveRcUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || \`Request failed (\${res.status})\`);
  }
  return data as T;
}

export function TrackList({
  initialTracks,
  favouriteTrackIds = [],
}: {
  initialTracks: Track[];
  favouriteTrackIds?: string[];
}) {
  const favSet = new Set(favouriteTrackIds);
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [liveRcUrl, setLiveRcUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [existingTrackId, setExistingTrackId] = useState<string | null>(null);

  useEffect(() => {
    setTracks(initialTracks);
  }, [initialTracks]);

  const filteredTracks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.location?.toLowerCase().includes(q) ?? false)
    );
  }, [tracks, search]);

  const searchLooksUnmatched =
    search.trim().length > 0 &&
    filteredTracks.length === 0 &&
    !tracks.some((t) => t.name.toLowerCase() === search.trim().toLowerCase());

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    setMessage(null);
    setExistingTrackId(null);
    setAdding(true);
    try {
      const res = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          location: location.trim() || null,
          liveRcUrl: liveRcUrl.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        track?: Track;
        error?: string;
        existingTrackId?: string;
      };
      if (res.status === 409 && data.existingTrackId) {
        setExistingTrackId(data.existingTrackId);
        setMessage(data.error ?? "Track already exists.");
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? \`Request failed (\${res.status})\`);
      }
      if (data.track) {
        setTracks((prev) => [data.track!, ...prev]);
        setName("");
        setLocation("");
        setLiveRcUrl("");
        setShowAddForm(false);
        setMessage("Track added.");
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add track");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-[11px] text-muted-foreground">Search tracks</label>
        <input
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search community catalog by name or location"
        />
      </div>

      {searchLooksUnmatched || showAddForm ? (
        <form onSubmit={handleAdd} className="rounded-lg border border-border bg-muted/70 p-4 space-y-3">
          <div className="ui-title text-sm text-muted-foreground">
            {searchLooksUnmatched ? "Cannot find it? Add a new track" : "Add track"}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
              <input
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Silverstone National"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Location (optional)</label>
              <input
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Melbourne, AU"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">LiveRC URL (optional)</label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={liveRcUrl}
              onChange={(e) => setLiveRcUrl(e.target.value)}
              placeholder="https://tftr.liverc.com/"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={adding}
              className={cn(
                buttonLinkClassName("primary"),
                adding && "opacity-70 pointer-events-none"
              )}
            >
              {adding ? "Adding…" : "Add track"}
            </button>
            {!searchLooksUnmatched ? (
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/80"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
            ) : null}
            {message ? (
              <span className={cn("text-xs", message === "Track added." ? "text-accent" : "text-muted-foreground")}>
                {message}
                {existingTrackId ? (
                  <>
                    {" "}
                    <Link href={\`/tracks/\${existingTrackId}\`} className="underline font-medium">
                      Open existing track
                    </Link>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <button
          type="button"
          className={cn(buttonLinkClassName("outline"), "text-xs")}
          onClick={() => {
            setShowAddForm(true);
            if (search.trim() && !name.trim()) setName(search.trim());
          }}
        >
          Cannot find it? Add a new track
        </button>
      )}

      <div>
        <div className="ui-title text-sm text-muted-foreground mb-2">Tracks</div>
        {filteredTracks.length === 0 ? (
          <CardPanel className="bg-muted/70 text-sm text-muted-foreground">
            {search.trim() ? "No tracks match your search." : "No tracks yet. Add one above or from Log your run."}
          </CardPanel>
        ) : (
          <ul className="rounded-lg border border-border divide-y divide-border">
            {filteredTracks.map((t) => (
              <li key={t.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {favSet.has(t.id) && (
                      <span className="text-yellow-500 shrink-0" aria-label="Favourite" title="Favourite">
                        ★
                      </span>
                    )}
                    <div>
                      <Link href={\`/tracks/\${t.id}\`} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                      {t.location ? (
                        <span className="text-muted-foreground text-sm ml-2">({t.location})</span>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground font-mono shrink-0">{t.id.slice(0, 8)}</span>
                </div>
                {!trackHasMarkedLocation(t) ? (
                  <TrackLocationNotSetBanner
                    trackId={t.id}
                    trackName={t.name}
                    location={t.location}
                    initial={{ latitude: t.latitude, longitude: t.longitude }}
                    showCurrentLocation={false}
                    onSaved={(saved) => {
                      setTracks((prev) =>
                        prev.map((x) => (x.id === t.id ? { ...x, ...saved } : x))
                      );
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
`;
fs.writeFileSync("src/components/tracks/TrackList.tsx", trackList);
console.log("TrackList written");

let nf = fs.readFileSync("src/components/runs/NewRunForm.tsx", "utf8");
if (!nf.includes("TrackLocationNotSetBanner")) {
  nf = nf.replace(
    'import { TrackLocationMarkDialog } from "@/components/tracks/TrackLocationMarkDialog";',
    'import { TrackLocationMarkDialog } from "@/components/tracks/TrackLocationMarkDialog";\nimport { TrackLocationNotSetBanner } from "@/components/tracks/TrackLocationNotSetBanner";\nimport { trackHasMarkedLocation } from "@/lib/location/coordinates";'
  );
  nf = nf.replace(
    `<TrackNearbySuggestions
                    suggestions={nearbyTrackSuggestions}
                    onSelect={(id) => {
                      trackPickedManuallyRef.current = true;
                      setTrackId(id);
                      setCopyTrackWarning(null);
                      setNearbyTrackSuggestions([]);
                      setTrackAutoDetectMessage(null);
                    }}
                  />
                </div>
              )}`,
    `<TrackNearbySuggestions
                    suggestions={nearbyTrackSuggestions}
                    onSelect={(id) => {
                      trackPickedManuallyRef.current = true;
                      setTrackId(id);
                      setCopyTrackWarning(null);
                      setNearbyTrackSuggestions([]);
                      setTrackAutoDetectMessage(null);
                    }}
                  />
                  {(() => {
                    const t = tracksList.find((x) => x.id === trackId);
                    if (!t || trackHasMarkedLocation(t)) return null;
                    return (
                      <TrackLocationNotSetBanner
                        trackId={t.id}
                        trackName={t.name}
                        location={t.location}
                        initial={{ latitude: t.latitude, longitude: t.longitude }}
                        showCurrentLocation
                        onSaved={(saved) => {
                          setTracksList((prev) =>
                            prev.map((x) => (x.id === t.id ? { ...x, ...saved } : x))
                          );
                        }}
                      />
                    );
                  })()}
                </div>
              )}`
  );
  fs.writeFileSync("src/components/runs/NewRunForm.tsx", nf);
  console.log("NewRunForm patched");
}
