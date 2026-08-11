"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { HubRowTitle } from "@/components/ui/panel";
import { Collapse } from "@/components/ui/Collapse";
import { CollapsibleAddRow } from "@/components/assets/CollapsibleAddRow";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import { TrackLocationNotSetBanner } from "@/components/tracks/TrackLocationNotSetBanner";
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
  // One box for either provider, matching the run form's "New track" row — the driver
  // shouldn't have to know which timing column they're filling in.
  const [timingUrls, setTimingUrls] = useState<TrackTimingUrls>(NO_TIMING_URLS);
  const timingFieldRef = useRef<TrackTimingUrlsFieldHandle>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [existingTrackId, setExistingTrackId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

      <SurfaceCard variant="panel" contentClassName="p-0" overflowHidden={false}>
        <ul className="divide-y divide-border">
          <CollapsibleAddRow
            label="Add a new track"
            open={showAddForm}
            onOpenChange={(next) => {
              setShowAddForm(next);
              if (next && search.trim() && !name.trim()) setName(search.trim());
            }}
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
                  <label className="block text-[11px] text-muted-foreground mb-1">Location (optional)</label>
                  <input
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Melbourne, AU"
                  />
                </div>
              </div>
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
              {search.trim() ? "No tracks match your search." : "No tracks yet. Add one above or from Log your run."}
            </li>
          ) : (
            filteredTracks.map((t) => {
              const expanded = expandedId === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      setExpandedId((cur) => (cur === t.id ? null : t.id));
                    }}
                    aria-expanded={expanded}
                    className="tap-active flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      {favSet.has(t.id) && (
                        <span className="text-yellow-500 shrink-0" aria-label="Favourite" title="Favourite">
                          ★
                        </span>
                      )}
                      <span className="min-w-0">
                        <HubRowTitle as="span">{t.name}</HubRowTitle>
                        {t.location ? (
                          <span className="text-muted-foreground text-sm ml-2">({t.location})</span>
                        ) : null}
                      </span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        expanded && "rotate-90"
                      )}
                      aria-hidden
                    />
                  </button>

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
    </div>
  );
}
