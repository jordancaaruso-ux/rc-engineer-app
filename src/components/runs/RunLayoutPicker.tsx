"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-muted-foreground">Layout</label>
        {inheritedFromEvent && layoutId ? (
          <span className="text-[10px] text-muted-foreground">From event</span>
        ) : null}
      </div>
      {layouts.length === 0 ? (
        <p className="text-[11px] text-muted-foreground leading-snug">
          {loading
            ? "Loading layouts…"
            : "No layouts saved for this track. Add them on the track page to select one here."}
        </p>
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
        />
      )}

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">Direction</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {directions.map((d) => {
            const active = direction === d.value;
            return (
              <button
                key={d.value}
                type="button"
                disabled={disabled}
                onClick={() => onDirectionChange(active ? "" : d.value)}
                className={cn(
                  "px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-60",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                )}
                aria-pressed={active}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        {direction ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDirectionChange("")}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
