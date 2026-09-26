"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { chipToggleClass } from "@/components/ui/chipToggle";

export type RunLayoutOption = { id: string; name: string; notes: string | null };

export type RunDirection = "" | "CW" | "CCW";

/**
 * Layout + direction selector for logging/editing a run. Layouts are fetched for
 * the currently-selected track. Both are optional (a track may have no layouts,
 * and direction is never required). Descriptive only — does not affect aggregation.
 */
export function RunLayoutPicker({
  trackId,
  layoutId,
  direction,
  onLayoutChange,
  onDirectionChange,
  disabled = false,
  inheritedFromEvent = false,
}: {
  trackId: string;
  layoutId: string;
  direction: RunDirection;
  onLayoutChange: (id: string) => void;
  onDirectionChange: (dir: RunDirection) => void;
  disabled?: boolean;
  /** Show a hint that the value came from the event default. */
  inheritedFromEvent?: boolean;
}) {
  const [layouts, setLayouts] = useState<RunLayoutOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const id = trackId.trim();
    if (!id) {
      setLayouts([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tracks/${encodeURIComponent(id)}/layouts`)
      .then((res) => (res.ok ? res.json() : { layouts: [] }))
      .then((data: { layouts?: RunLayoutOption[] }) => {
        if (cancelled) return;
        setLayouts(Array.isArray(data.layouts) ? data.layouts : []);
      })
      .catch(() => {
        if (!cancelled) setLayouts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  // If the selected layout isn't among this track's layouts (e.g. track changed),
  // clear it so we never submit a layout from a different track.
  useEffect(() => {
    if (loading) return;
    if (layoutId && !layouts.some((l) => l.id === layoutId)) {
      onLayoutChange("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layouts, loading]);

  if (!trackId.trim()) return null;

  const directions: { value: RunDirection; label: string }[] = [
    { value: "CW", label: "CW" },
    { value: "CCW", label: "CCW" },
  ];

  // One row under the track (founder pick "B", 2026-09-26): the layout box or "Add layout", then CW
  // and CCW, at the size of the Near me and New track chips above it. It was three lines, with the
  // words Layout and Direction on lines of their own, for two small optional choices. "No layout"
  // stays the first entry in the box, so a driver whose layout isn't listed just leaves it there
  // (the founder's one worry). Tapping the lit direction again clears it, so the separate Clear went.
  return (
    <div className="flex flex-wrap items-center gap-2">
      {layouts.length === 0 ? (
        loading ? (
          <p className="text-[11px] text-muted-foreground leading-snug">Loading layouts…</p>
        ) : (
          // `.btn-surface`'s look spelled out: it is unlayered CSS, so its 6px corners would beat
          // the 8px the chips beside it wear.
          <Link
            href={`/tracks/${encodeURIComponent(trackId)}`}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-runna px-3 text-xs text-muted-foreground transition hover:bg-surface-runna-inset hover:text-foreground"
            aria-label="Add a layout on the track page"
            title="Add a layout"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            Add layout
          </Link>
        )
      ) : (
        <SearchableSelect
          aria-label="Track layout"
          placeholder="No layout"
          clearable
          clearLabel="No layout"
          searchable={layouts.length > 6}
          disabled={disabled}
          value={layoutId}
          onChange={onLayoutChange}
          options={layouts.map((l) => ({ value: l.id, label: l.name }))}
          className="h-8 min-w-0 flex-1 py-0 text-[13px]"
        />
      )}
      <div role="group" aria-label="Direction" className="flex gap-1.5">
        {directions.map((d) => {
          const active = direction === d.value;
          return (
            <button
              key={d.value}
              type="button"
              disabled={disabled}
              onClick={() => onDirectionChange(active ? "" : d.value)}
              className={cn(chipToggleClass(active), "min-h-8 rounded-lg px-3 text-xs")}
              aria-pressed={active}
            >
              {d.label}
            </button>
          );
        })}
      </div>
      {inheritedFromEvent && layoutId ? (
        <span className="text-[11px] text-muted-foreground">From event</span>
      ) : null}
    </div>
  );
}
