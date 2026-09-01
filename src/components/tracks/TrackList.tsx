"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Search, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { HubRowTitle } from "@/components/ui/panel";
import { Collapse } from "@/components/ui/Collapse";
import { CollapsibleAddRow } from "@/components/assets/CollapsibleAddRow";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import { TrackLocationNotSetBanner } from "@/components/tracks/TrackLocationNotSetBanner";
import {
  TrackCoordinatesField,
  type TrackCoordinatesFieldHandle,
  type TrackCoordinatesValue,
} from "@/components/tracks/TrackCoordinatesField";
import { TrackNearbyBrowse } from "@/components/tracks/TrackNearbyBrowse";
import { TrackMetaTagsEditor } from "@/components/tracks/TrackMetaTagsEditor";
import type { TrackTimingUrls } from "@/lib/tracks/trackTimingUrl";
import {
  TrackTimingUrlsField,
  type TrackTimingUrlsFieldHandle,
} from "@/components/tracks/TrackTimingUrlsField";

const NO_TIMING_URLS: TrackTimingUrls = { liveRcUrl: null, speedhiveUrl: null };

type Track = {
  id: string;
  name: string;
  location?: string | null;
  liveRcUrl?: string | null;
  speedhiveUrl?: string | null;
  gripTags?: string[];
  layoutTags?: string[];
  latitude?: number | null;
  longitude?: number | null;
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function TrackList({
  initialTracks,
  favouriteTrackIds = [],
  focusTrackId = null,
  catalogCount = 0,
}: {
  initialTracks: Track[];
  favouriteTrackIds?: string[];
  /** From `/tracks?trackId=…` — the row the Paddock band sent us to. */
  focusTrackId?: string | null;
  /** Size of the whole catalog. `initialTracks` is only the first screen of it. */
  catalogCount?: number;
}) {
  const router = useRouter();
  /*
   * Favourites are STATE here, not a set derived at render.
   *
   * They were derived, because the star was a read-only badge: the only way to actually set
   * one was on the track's own page, four taps away behind a grey "Open track →" link at the
   * bottom of an expanded row. That made a shipped feature invisible to the person it exists
   * for (founder note on /paddock, 2026-08-18: "I can't see anywhere where to do it").
   */
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(
    () => new Set(favouriteTrackIds)
  );
  const [pendingFavouriteIds, setPendingFavouriteIds] = useState<Set<string>>(new Set());
  const [favouriteError, setFavouriteError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  // One box for either provider, matching the run form's "New track" row — the driver
  // shouldn't have to know which timing column they're filling in.
  const [timingUrls, setTimingUrls] = useState<TrackTimingUrls>(NO_TIMING_URLS);
  const timingFieldRef = useRef<TrackTimingUrlsFieldHandle>(null);
  const [coordinates, setCoordinates] = useState<TrackCoordinatesValue | null>(null);
  const coordsFieldRef = useRef<TrackCoordinatesFieldHandle>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [existingTrackId, setExistingTrackId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setTracks(initialTracks);
  }, [initialTracks]);

  // Joined rather than depended on by reference: the prop is a fresh array on every server
  // render, and re-syncing on identity would clobber an in-flight optimistic toggle.
  const favouriteKey = favouriteTrackIds.join(",");
  useEffect(() => {
    setFavouriteIds(new Set(favouriteTrackIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favouriteKey]);

  /*
   * `?trackId=…` opens that row and puts it on screen.
   *
   * The Paddock tracks band has always linked here with the id and nothing read it — so
   * tapping "Southside · 31 runs" landed you at the top of a catalog of hundreds with the
   * track you had just tapped nowhere in sight.
   */
  useEffect(() => {
    if (!focusTrackId) return;
    setExpandedId(focusTrackId);
    document.getElementById(`track-row-${focusTrackId}`)?.scrollIntoView({ block: "center" });
  }, [focusTrackId]);

  /**
   * Favourite straight from the row.
   *
   * Optimistic, and deliberately WITHOUT a `router.refresh()`. The server sorts favourites
   * to the top of the catalog, so refreshing would snatch the row out from under the finger
   * that just tapped it and lose your place in a list of hundreds. The API revalidates the
   * page and the Paddock cache tag, so the order is right the next time you arrive — which
   * is the moment it actually matters.
   */
  async function toggleFavourite(trackId: string) {
    if (pendingFavouriteIds.has(trackId)) return;
    const wasFavourite = favouriteIds.has(trackId);
    haptic("light");
    setFavouriteError(null);
    setPendingFavouriteIds((cur) => new Set(cur).add(trackId));
    setFavouriteIds((cur) => {
      const next = new Set(cur);
      if (wasFavourite) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
    try {
      const data = await jsonFetch<{ ok: true; added: boolean }>(
        `/api/tracks/${trackId}/favourite`,
        { method: "POST" }
      );
      // The server's answer wins over the guess — two quick taps can land out of order.
      setFavouriteIds((cur) => {
        const next = new Set(cur);
        if (data.added) next.add(trackId);
        else next.delete(trackId);
        return next;
      });
    } catch (err) {
      setFavouriteIds((cur) => {
        const next = new Set(cur);
        if (wasFavourite) next.add(trackId);
        else next.delete(trackId);
        return next;
      });
      setFavouriteError(err instanceof Error ? err.message : "Could not update favourites");
    } finally {
      setPendingFavouriteIds((cur) => {
        const next = new Set(cur);
        next.delete(trackId);
        return next;
      });
    }
  }

  /*
   * Search runs on the SERVER now.
   *
   * `initialTracks` used to be the entire catalog, so filtering it in the browser was the whole
   * search. With the catalog pre-seeded to ~1,500 tracks the page only receives a first screen —
   * favourites and the countries this driver races in — so anything else has to be asked for.
   * A single character still filters locally, because that is instant and the server round trip
   * for one letter would return a hundred rows nobody wanted.
   */
  const [remoteTracks, setRemoteTracks] = useState<Track[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setRemoteTracks(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const data = await jsonFetch<{ tracks: Track[] }>(
            `/api/tracks?limit=50&q=${encodeURIComponent(q)}`
          );
          setRemoteTracks(data.tracks);
        } catch {
          setRemoteTracks([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 220);
    return () => clearTimeout(timer);
  }, [search]);

  const filteredTracks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tracks;
    if (remoteTracks) return remoteTracks;
    return tracks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.location?.toLowerCase().includes(q) ?? false)
    );
  }, [tracks, search, remoteTracks]);

  const searchLooksUnmatched =
    search.trim().length > 0 &&
    // Never while a lookup is in flight: the list is momentarily empty during the debounce, and
    // auto-opening the add form there would have a driver typing a name the catalog already has.
    !searching &&
    filteredTracks.length === 0 &&
    !tracks.some((t) => t.name.toLowerCase() === search.trim().toLowerCase());

  // A search that matches nothing auto-opens the add-track row and prefills the name.
  useEffect(() => {
    if (searchLooksUnmatched) {
      setShowAddForm(true);
      setName((cur) => (cur.trim() ? cur : search.trim()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLooksUnmatched]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    // Fold in a paste they never pressed Enter on, and refuse a typo before saving.
    const committed = timingFieldRef.current?.commit() ?? { ok: true as const, value: timingUrls };
    if (!committed.ok) {
      setMessage(committed.error);
      return;
    }
    const timing = {
      liveRcUrl: committed.value.liveRcUrl ?? null,
      speedhiveUrl: committed.value.speedhiveUrl ?? null,
    };
    // Same rule for a coordinates paste nobody pressed Enter on.
    const committedCoords =
      coordsFieldRef.current?.commit() ?? { ok: true as const, value: coordinates };
    if (!committedCoords.ok) {
      setMessage(committedCoords.error);
      return;
    }
    const coords = committedCoords.value
      ? {
          latitude: committedCoords.value.latitude,
          longitude: committedCoords.value.longitude,
          locationSource: committedCoords.value.locationSource,
        }
      : {};
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
          ...timing,
          ...coords,
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
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      if (data.track) {
        setTracks((prev) => [data.track!, ...prev]);
        setName("");
        setLocation("");
        setTimingUrls(NO_TIMING_URLS);
        setCoordinates(null);
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

  /**
   * Opening the form carries the search across, so a driver who searched for a track that isn't
   * in the catalog doesn't type its name a second time. Shared by the row's own header and the
   * "+" in the search bar — one path, so the prefill can't drift between them.
   */
  function openAddForm() {
    setShowAddForm(true);
    if (search.trim() && !name.trim()) setName(search.trim());
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-[11px] text-muted-foreground" htmlFor="track-catalog-search">
          Search tracks
        </label>
        {/* Composed like the picker sheet's search row rather than a bare box, so the two ways
            into the same catalog look like the same control — and so "add one" has somewhere to
            live at the top of the page. Under a long catalog on a phone the add row is below the
            fold, which is the whole reason the + is worth having here. */}
        <div className="search-row-composite flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 transition-colors focus-within:border-ring/45">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
          <input
            id="track-catalog-search"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              catalogCount > 0
                ? `Search ${catalogCount.toLocaleString()} tracks by name, town or state`
                : "Search community catalog by name or location"
            }
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="tap-active -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" strokeWidth={2} aria-hidden />
            </button>
          ) : null}
          {/* No "+" here on purpose: "Add a new track" is the first row of the card immediately
              below, already labelled and a bigger target, and the dock carries the log-run FAB —
              three + glyphs in one column, two of them the same action. */}
        </div>
      </div>

      {favouriteError ? (
        <p className="text-xs text-muted-foreground" role="status">
          {favouriteError}
        </p>
      ) : null}

      {/* Hidden while searching — a driver who has typed a name is not browsing by proximity. */}
      {search.trim() ? null : <TrackNearbyBrowse />}

      <SurfaceCard variant="panel" contentClassName="p-0" overflowHidden={false}>
        <ul className="divide-y divide-border">
          <CollapsibleAddRow
            label="Add a new track"
            open={showAddForm}
            onOpenChange={(next) => (next ? openAddForm() : setShowAddForm(false))}
          >
            <form onSubmit={handleAdd} className="space-y-3">
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
                  <label className="block text-[11px] text-muted-foreground mb-1">Town or state (optional)</label>
                  <input
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Melbourne, AU"
                  />
                </div>
              </div>
              <TrackCoordinatesField
                ref={coordsFieldRef}
                value={coordinates}
                onChange={setCoordinates}
                onError={setMessage}
                labelClassName="block text-[11px] text-muted-foreground"
                inputClassName="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              />
              <TrackTimingUrlsField
                ref={timingFieldRef}
                value={timingUrls}
                onChange={setTimingUrls}
                onError={setMessage}
                labelClassName="block text-[11px] text-muted-foreground"
                inputClassName="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              />
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
                {message ? (
                  <span className={cn("text-xs", message === "Track added." ? "text-primary-ink" : "text-muted-foreground")}>
                    {message}
                    {existingTrackId ? (
                      <>
                        {" "}
                        <Link href={`/tracks/${existingTrackId}`} className="underline font-medium">
                          Open existing track
                        </Link>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </form>
          </CollapsibleAddRow>

          {filteredTracks.length === 0 ? (
            <li className="px-4 py-4 text-sm text-muted-foreground">
              {searching
                ? "Searching…"
                : search.trim()
                  ? "No tracks match your search."
                  : "No tracks yet. Add one above or from Log your run."}
            </li>
          ) : (
            filteredTracks.map((t) => {
              const expanded = expandedId === t.id;
              const isFavourite = favouriteIds.has(t.id);
              return (
                <li key={t.id} id={`track-row-${t.id}`}>
                  <div className="flex items-stretch transition hover:bg-muted/50">
                    {/* A SIBLING of the disclosure button, never a child: the row is itself a
                        <button>, and a button nested inside a button is invalid markup no two
                        browsers treat the same. 44px wide because this control is the whole
                        reason anyone will find the feature — 16px of glyph is a badge, not a
                        target. */}
                    <button
                      type="button"
                      onClick={() => void toggleFavourite(t.id)}
                      aria-pressed={isFavourite}
                      aria-label={
                        isFavourite
                          ? `Remove ${t.name} from favourites`
                          : `Add ${t.name} to favourites`
                      }
                      className={cn(
                        "tap-active group flex w-11 shrink-0 items-center justify-center transition",
                        pendingFavouriteIds.has(t.id) && "opacity-50"
                      )}
                    >
                      {/* Outlined when it is not one — an empty star is what tells you the
                          control is there at all. Filled uses `primary-ink`, yellow doing a
                          foreground job, matching the star in the Paddock band. */}
                      <Star
                        className={cn(
                          "size-[18px] transition",
                          isFavourite
                            ? "fill-primary-ink text-primary-ink"
                            : "text-muted-foreground/70 group-hover:text-primary-ink"
                        )}
                        strokeWidth={2}
                        aria-hidden
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        haptic("light");
                        setExpandedId((cur) => (cur === t.id ? null : t.id));
                      }}
                      aria-expanded={expanded}
                      className="tap-active flex min-w-0 flex-1 items-center gap-2 py-3 pr-4 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <HubRowTitle as="span">{t.name}</HubRowTitle>
                        {t.location ? (
                          <span className="text-muted-foreground text-sm ml-2">({t.location})</span>
                        ) : null}
                      </span>
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          expanded && "rotate-90"
                        )}
                        aria-hidden
                      />
                    </button>
                  </div>

                  <Collapse open={expanded}>
                    <div className="space-y-2 px-4 pb-4 pt-0">
                      <div className="w-fit max-w-full">
                        <TrackMetaTagsEditor
                          trackId={t.id}
                          initialGripTags={t.gripTags ?? []}
                          initialLayoutTags={t.layoutTags ?? []}
                          compact
                          onSaved={(saved) => {
                            setTracks((prev) =>
                              prev.map((x) =>
                                x.id === t.id
                                  ? { ...x, gripTags: saved.gripTags, layoutTags: saved.layoutTags }
                                  : x
                              )
                            );
                          }}
                        />
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
                      <Link
                        href={`/tracks/${t.id}`}
                        prefetch
                        className="tap-active block text-xs text-muted-foreground hover:text-foreground"
                      >
                        Open track →
                      </Link>
                    </div>
                  </Collapse>
                </li>
              );
            })
          )}
        </ul>
      </SurfaceCard>

      {/* Says out loud that this is a first screen, not the catalog — otherwise a driver whose
          track is one of the other 1,400 concludes it isn't there and adds a duplicate, which is
          the one outcome the seed exists to prevent. */}
      {!search.trim() && catalogCount > filteredTracks.length ? (
        <p className="px-1 text-xs text-muted-foreground">
          Showing {filteredTracks.length} of {catalogCount.toLocaleString()} tracks — search to find
          any of the rest.
        </p>
      ) : null}
    </div>
  );
}
