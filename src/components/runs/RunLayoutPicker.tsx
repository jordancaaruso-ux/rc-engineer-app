"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PickerSheet, PickerTrigger } from "@/components/ui/PickerSheet";
import { chipToggleClass } from "@/components/ui/chipToggle";
import type { OptionSection } from "@/lib/search/optionSearch";
import { LAYOUT_NAME_MAX } from "@/lib/tracks/trackLayouts";

export type RunLayoutOption = { id: string; name: string; notes: string | null };

export type RunDirection = "" | "CW" | "CCW";

/**
 * Layout + direction selector for logging/editing a run. Layouts are fetched for
 * the currently-selected track. Both are optional (a track may have no layouts,
 * and direction is never required). Descriptive only — does not affect aggregation.
 *
 * A layout is added right here, in a small sheet over the run (founder pick "A", 2026-09-26). "Add
 * layout" used to be a link to the track's page in the Paddock: the wizard keeps no draft, so the
 * run being logged was thrown away on the way out, and on a track somebody else added (every LiveRC
 * track) a driver found no way to add a layout there anyway. Any driver may add one now, and everyone
 * racing at that track sees it (`src/lib/tracks/trackLayouts.ts`).
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
  // Open and what it shows are kept apart so the sheet keeps its face while it slides away:
  // closing on "Add layout" must not flash the list on the way down.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<"list" | "new">("list");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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

  const sections = useMemo<OptionSection[]>(
    () => [
      { key: "layouts", label: null, options: layouts.map((l) => ({ value: l.id, label: l.name })) },
    ],
    [layouts]
  );

  if (!trackId.trim()) return null;

  const directions: { value: RunDirection; label: string }[] = [
    { value: "CW", label: "CW" },
    { value: "CCW", label: "CCW" },
  ];
  const selected = layouts.find((l) => l.id === layoutId) ?? null;

  function openSheet(view: "list" | "new", seedName = "") {
    setSheetView(view);
    setNewName(seedName);
    setAddError(null);
    setSheetOpen(true);
  }

  async function addLayout() {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/layouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        layout?: RunLayoutOption;
        error?: string;
      };
      if (!res.ok || !data.layout) {
        setAddError(data.error ?? "Couldn’t add the layout. Try again.");
        return;
      }
      const layout = data.layout;
      // A name the track already had comes back as that layout, which is already in the list.
      setLayouts((prev) => (prev.some((l) => l.id === layout.id) ? prev : [...prev, layout]));
      onLayoutChange(layout.id);
      setSheetOpen(false);
    } catch {
      setAddError("Couldn’t add the layout. Check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  const newLayoutForm = (
    <div className="space-y-2">
      <input
        type="text"
        autoFocus
        value={newName}
        onChange={(e) => {
          setNewName(e.target.value);
          setAddError(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // The sheet is portalled out of the run form, but React still bubbles the key into it.
          e.preventDefault();
          e.stopPropagation();
          void addLayout();
        }}
        placeholder="Layout name"
        aria-label="Layout name"
        maxLength={LAYOUT_NAME_MAX}
        autoCapitalize="words"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none"
      />
      {addError ? (
        <p className="text-[11px] text-destructive" role="alert">
          {addError}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void addLayout()}
        disabled={adding || !newName.trim()}
        className="tap-active w-full rounded-md primary-face bg-primary px-3 py-2.5 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {adding ? "Adding…" : "Add layout"}
      </button>
    </div>
  );

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
          <button
            type="button"
            onClick={() => openSheet("new")}
            disabled={disabled}
            aria-haspopup="dialog"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-runna px-3 text-xs text-muted-foreground transition hover:bg-surface-runna-inset hover:text-foreground disabled:opacity-60"
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
          </button>
        )
      ) : (
        // Always the app's own list, not the phone's: only this list can hold "New layout".
        <PickerTrigger
          onClick={() => openSheet("list")}
          disabled={disabled}
          open={sheetOpen && sheetView === "list"}
          aria-label="Track layout"
          placeholder={!selected}
          className="form-control h-8 min-w-0 flex-1 py-0 text-[13px]"
        >
          {selected?.name ?? "No layout"}
        </PickerTrigger>
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
      <PickerSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Track layout"
        value={layoutId}
        onSelect={(id) => {
          onLayoutChange(id);
          setSheetOpen(false);
        }}
        sections={sections}
        searchPlaceholder="Search layouts…"
        clearRow={{ label: "No layout" }}
        // First row, as on the Event list (founder pick 2026-09-26). It carries anything typed.
        createRow={{ label: "New layout", onAction: (query) => openSheet("new", query) }}
        panel={sheetView === "new" ? newLayoutForm : null}
        panelTitle="New layout"
        // The one-box form hugs its contents, even over a track with a long list.
        searchable={sheetView === "new" ? false : undefined}
      />
    </div>
  );
}
