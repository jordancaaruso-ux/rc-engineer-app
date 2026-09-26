"use client";

import { useMemo, useState } from "react";
import { PickerSheet, PickerTrigger } from "@/components/ui/PickerSheet";
import type { OptionSection } from "@/lib/search/optionSearch";
import { formatDistanceMeters } from "@/lib/location/trackProximity";

export type TrackOption = {
  id: string;
  name: string;
  location?: string | null;
  gripTags?: string[];
  layoutTags?: string[];
  liveRcUrl?: string | null;
};

/**
 * "serccc" from https://serccc.liverc.com — the club's short name, which is what drivers type.
 * LiveRC-linked tracks carry LiveRC's full name since 2026-09-16, so without this "SERCCC" would
 * find nothing.
 */
function liveRcShortName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.split(".")[0] || null;
  } catch {
    return null;
  }
}

function trackRow(t: TrackOption) {
  return {
    value: t.id,
    label: t.name,
    detail: t.location ?? null,
    // "grip"/"layout" ride along with each tag: the search wants every typed word, so "high grip"
    // needs the word "grip" somewhere, and a bare "HIGH" doesn't say it.
    keywords:
      [
        ...(t.gripTags ?? []).map((g) => `${g} grip`),
        ...(t.layoutTags ?? []).map((l) => `${l} layout`),
        liveRcShortName(t.liveRcUrl),
      ]
        .filter(Boolean)
        .join(" ") || null,
  };
}

function trackLabel(t: TrackOption): string {
  return t.location ? `${t.name} (${t.location})` : t.name;
}

/**
 * Track picker — a `PickerSheet` with Favourites / All tracks.
 *
 * It went native in the 2026-07-14 sweep on the argument that track lists are
 * short enough for favourites-first grouping to replace type-to-search. That
 * holds for a club racer's first season and stops holding the moment someone
 * travels: by then the list is every venue they've ever entered, ordered
 * alphabetically, and finding one means scrolling an iOS wheel five rows at a
 * time. Same complaint as the tire list, same fix.
 *
 * The town is searchable in its own right — drivers reach for "Adelaide" as
 * often as for the club's name — and grip/layout tags match too, so "high grip"
 * or "carpet" narrows the list without any of that being on screen.
 *
 * `nearby` (the phone's position, measured by the caller) puts the closest tracks first. It only
 * orders the list — nothing is ever selected from a location (founder 2026-09-17).
 */
export function TrackCombobox({
  tracks,
  value,
  onChange,
  favouriteTrackIds = [],
  favouriteTracks = [],
  nearby = [],
  placeholder = "Select track…",
  "aria-label": ariaLabel = "Track",
  disabled,
  onCreateRequest,
}: {
  tracks: TrackOption[];
  value: string;
  onChange: (trackId: string) => void;
  lastRunTrackId?: string | null;
  favouriteTrackIds?: string[];
  favouriteTracks?: TrackOption[];
  /** Tracks near the phone, nearest first. */
  nearby?: { trackId: string; distanceM: number }[];
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
  /**
   * Add a track that isn't listed, carrying whatever was typed into the search.
   *
   * Measured 2026-08-13: a driver whose track was missing opened this sheet, found no way to add
   * one, and had to close it again — the "New track" chip lives on the page *behind* the sheet.
   * That was the only recorded dead end in ten new-account walks. First fixed with a sticky
   * footer; now the "+" at the end of the search row, which is reachable without scrolling the
   * list to its end and can't be mistaken for a list entry. Omit the prop and the sheet behaves
   * exactly as before.
   */
  onCreateRequest?: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Merge in favouriteTracks so a selected favourite not present in `tracks`
  // still renders its label (previous combobox had the same fallback).
  const all = useMemo(() => {
    const byId = new Map<string, TrackOption>();
    for (const t of [...tracks, ...favouriteTracks]) {
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
    return [...byId.values()];
  }, [tracks, favouriteTracks]);

  const sections = useMemo<OptionSection[]>(() => {
    const favSet = new Set(favouriteTrackIds);
    const byId = new Map(all.map((t) => [t.id, t]));
    const nearbyRows = nearby.flatMap((n) => {
      const t = byId.get(n.trackId);
      return t
        ? [{ ...trackRow(t), detail: [formatDistanceMeters(n.distanceM), t.location].filter(Boolean).join(" · ") }]
        : [];
    });
    const nearSet = new Set(nearbyRows.map((r) => r.value));
    const byName = (a: TrackOption, b: TrackOption) => a.name.localeCompare(b.name);
    return [
      {
        key: "nearby",
        label: "Nearby",
        options: nearbyRows,
      },
      {
        key: "favourites",
        label: "Favourites",
        options: all.filter((t) => favSet.has(t.id) && !nearSet.has(t.id)).sort(byName).map(trackRow),
      },
      {
        key: "all",
        label: "All tracks",
        options: all.filter((t) => !favSet.has(t.id) && !nearSet.has(t.id)).sort(byName).map(trackRow),
      },
    ];
  }, [all, favouriteTrackIds, nearby]);

  const selected = all.find((t) => t.id === value) ?? null;

  return (
    <>
      <PickerTrigger
        onClick={() => setOpen(true)}
        disabled={disabled}
        open={open}
        aria-label={ariaLabel}
        placeholder={!selected}
        className="rounded-lg border border-border bg-card"
      >
        {selected ? trackLabel(selected) : placeholder}
      </PickerTrigger>

      <PickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title={ariaLabel}
        value={value}
        onSelect={(id) => {
          onChange(id);
          setOpen(false);
        }}
        sections={sections}
        searchPlaceholder="Search tracks or towns…"
        clearRow={{ label: placeholder }}
        searchAction={
          onCreateRequest
            ? {
                label: "Add a track that isn’t listed",
                onAction: (query) => {
                  setOpen(false);
                  onCreateRequest(query);
                },
              }
            : undefined
        }
        emptyAction={
          onCreateRequest
            ? (query) => (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onCreateRequest(query);
                  }}
                  className="tap-active rounded-lg border border-border px-3 py-2 text-sm font-semibold text-primary-ink transition hover:bg-white/5"
                >
                  {query ? `Add “${query}”` : "Add a track"}
                </button>
              )
            : undefined
        }
      />
    </>
  );
}
