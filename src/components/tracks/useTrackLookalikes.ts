"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TrackLookalikeHit = {
  id: string;
  name: string;
  location: string | null;
  liveRcUrl: string | null;
  speedhiveUrl: string | null;
  why: string;
};

function keyOf(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function fetchLookalikes(name: string, location: string, signal?: AbortSignal): Promise<TrackLookalikeHit[]> {
  const q = new URLSearchParams({ name: name.trim() });
  if (location.trim()) q.set("location", location.trim());
  const res = await fetch(`/api/tracks/lookalikes?${q}`, { signal });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { lookalikes?: TrackLookalikeHit[] };
  return Array.isArray(data.lookalikes) ? data.lookalikes : [];
}

/**
 * The clubs already in the catalog that the name typed into an add-track form plainly means
 * (GET /api/tracks/lookalikes; founder ruling 2026-09-26, option B). Waits for a pause in typing
 * and the newest answer wins. "No, it's a different club" is remembered per typed name, so the
 * same suggestion doesn't come straight back.
 *
 * `checkNow` asks at once and resolves with what it found: the forms call it before they create,
 * so a driver who types fast and presses Enter still sees the club that's already there.
 */
export function useTrackLookalikes(name: string, location: string, enabled: boolean) {
  const [answer, setAnswer] = useState<{ key: string; hits: TrackLookalikeHit[] }>({ key: "", hits: [] });
  const [differentKeys, setDifferentKeys] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef(0);
  const key = keyOf(name);
  const isDifferentClub = differentKeys.has(key);

  useEffect(() => {
    if (!enabled || key.length < 3 || isDifferentClub) return;
    const id = ++latest.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchLookalikes(name, location, ctrl.signal)
        .then((hits) => {
          if (id === latest.current) setAnswer({ key, hits });
        })
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, key, isDifferentClub, name, location]);

  const checkNow = useCallback(async (): Promise<TrackLookalikeHit[]> => {
    const k = keyOf(name);
    if (!enabled || k.length < 3 || differentKeys.has(k)) return [];
    const id = ++latest.current;
    const hits = await fetchLookalikes(name, location).catch(() => [] as TrackLookalikeHit[]);
    if (id === latest.current) setAnswer({ key: k, hits });
    return hits;
  }, [enabled, name, location, differentKeys]);

  const differentClub = useCallback(() => {
    setDifferentKeys((prev) => new Set(prev).add(keyOf(name)));
  }, [name]);

  const hits = enabled && key.length >= 3 && !isDifferentClub && answer.key === key ? answer.hits : [];
  return { hits, checkNow, differentClub, isDifferentClub };
}
