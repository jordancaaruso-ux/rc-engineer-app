"use client";

export type TrackOption = {
  id: string;
  name: string;
  location?: string | null;
  gripTags?: string[];
  layoutTags?: string[];
};

function trackLabel(t: TrackOption): string {
  return t.location ? `${t.name} (${t.location})` : t.name;
}

/**
 * Track picker — a native `<select>` with Favourites / All tracks optgroups.
 *
 * Deliberately native (founder decision 2026-07-14): on iPhone the OS draws the
 * menu itself — compositor-attached, background scroll locked, keyboard never
 * opens. The previous custom search-combobox (portal + fixed + JS re-pin)
 * rubber-banded on iOS touch scroll; track lists are short enough that
 * favourites-first grouping replaces type-to-search.
 */
export function TrackCombobox({
  tracks,
  value,
  onChange,
  favouriteTrackIds = [],
  favouriteTracks = [],
  placeholder = "Select track…",
  "aria-label": ariaLabel = "Track",
  disabled,
}: {
  tracks: TrackOption[];
  value: string;
  onChange: (trackId: string) => void;
  lastRunTrackId?: string | null;
  favouriteTrackIds?: string[];
  favouriteTracks?: TrackOption[];
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  // Merge in favouriteTracks so a selected favourite not present in `tracks`
  // still renders its label (previous combobox had the same fallback).
  const byId = new Map<string, TrackOption>();
  for (const t of [...tracks, ...favouriteTracks]) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }
  const all = [...byId.values()];
  const favSet = new Set(favouriteTrackIds);
  const favourites = all
    .filter((t) => favSet.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const others = all
    .filter((t) => !favSet.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <select
      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none disabled:opacity-60"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {favourites.length > 0 ? (
        <>
          <optgroup label="Favourites">
            {favourites.map((t) => (
              <option key={t.id} value={t.id}>
                {trackLabel(t)}
              </option>
            ))}
          </optgroup>
          <optgroup label="All tracks">
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {trackLabel(t)}
              </option>
            ))}
          </optgroup>
        </>
      ) : (
        others.map((t) => (
          <option key={t.id} value={t.id}>
            {trackLabel(t)}
          </option>
        ))
      )}
    </select>
  );
}
