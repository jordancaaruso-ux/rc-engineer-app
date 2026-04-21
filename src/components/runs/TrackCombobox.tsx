"use client";

import { Fragment, useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type TrackOption = {
  id: string;
  name: string;
  location?: string | null;
  gripTags?: string[];
  layoutTags?: string[];
};

type TrackSortMode = "favourites_then_alpha";

function orderTracksForPicker(
  tracks: TrackOption[],
  favouriteTrackIds: string[],
  mode: TrackSortMode = "favourites_then_alpha"
): { favourites: TrackOption[]; others: TrackOption[]; all: TrackOption[] } {
  // Future: swap mode to include geo-distance sorting, keeping favourites pinned to top.
  const favSet = new Set(favouriteTrackIds);
  const favourites = tracks
    .filter((t) => favSet.has(t.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const others = tracks
    .filter((t) => !favSet.has(t.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "favourites_then_alpha") {
    return { favourites, others, all: [...favourites, ...others] };
  }
  return { favourites, others, all: [...favourites, ...others] };
}

export function TrackCombobox({
  tracks,
  value,
  onChange,
  lastRunTrackId,
  favouriteTrackIds = [],
  favouriteTracks = [],
  placeholder = "Search or select track",
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
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedTrack = value ? (tracks.find((t) => t.id === value) ?? favouriteTracks.find((t) => t.id === value)) : null;
  const selectedLabel = selectedTrack ? (selectedTrack.location ? `${selectedTrack.name} (${selectedTrack.location})` : selectedTrack.name) : "";
  const displayValue = isOpen ? (query || selectedLabel) : selectedLabel;

  const favSet = new Set(favouriteTrackIds);
  const ordered = orderTracksForPicker(tracks, favouriteTrackIds);

  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const list = ordered.all.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.location ?? "").toLowerCase().includes(q)
      );
      return list;
    }
    return ordered.all;
  })();

  useEffect(() => {
    if (!isOpen) return;
    setHighlightIndex(0);
  }, [isOpen, query, filtered.length]);

  useEffect(() => {
    if (!isOpen || highlightIndex < 0) return;
    const hasSection = !query.trim() && favouriteTracks.length > 0 && filtered.length > 0;
    const offset = hasSection ? 1 : 0;
    const el = listRef.current?.children[highlightIndex + offset] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, isOpen, query, favouriteTracks.length, filtered.length]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function select(id: string) {
    onChange(id);
    setQuery("");
    setIsOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i < filtered.length - 1 ? i + 1 : i));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i > 0 ? i - 1 : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[highlightIndex];
      if (item) select(item.id);
      return;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
        placeholder={placeholder}
        value={isOpen ? query : displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls="track-combobox-list"
        disabled={disabled}
      />
      {isOpen && (
        <ul
          id="track-combobox-list"
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-secondary shadow-md py-1 text-sm"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">
              {query.trim() ? "No matching tracks" : "No favourite tracks yet"}
            </li>
          ) : (
            <>
              {!query.trim() && ordered.favourites.length > 0 ? (
                <li className="px-3 py-1.5 text-sm font-medium text-muted-foreground border-b border-border">
                  Favourites
                </li>
              ) : null}

              {filtered.map((t, i) => {
                const isDividerPoint =
                  !query.trim() &&
                  ordered.favourites.length > 0 &&
                  i === ordered.favourites.length;

                return (
                  <Fragment key={t.id}>
                    {isDividerPoint ? (
                      <li
                        key={`all-tracks-divider-${t.id}`}
                        className="px-3 py-1.5 text-sm font-medium text-muted-foreground border-y border-border"
                      >
                        All tracks
                      </li>
                    ) : null}
                    <li
                      role="option"
                      aria-selected={value === t.id}
                      className={cn(
                        "px-3 py-2 cursor-pointer flex items-center justify-between gap-2",
                        i === highlightIndex ? "bg-accent/20 text-foreground" : "text-foreground hover:bg-muted"
                      )}
                      onMouseEnter={() => setHighlightIndex(i)}
                      onClick={() => select(t.id)}
                    >
                      <span className="flex flex-col min-w-0">
                        <span>{t.name}</span>
                        {t.location && <span className="text-[11px] text-muted-foreground">{t.location}</span>}
                      </span>
                      {favSet.has(t.id) && <span className="text-yellow-500 shrink-0" aria-label="Favourite">★</span>}
                    </li>
                  </Fragment>
                );
              })}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
