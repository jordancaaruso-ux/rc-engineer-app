"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_RUN_HISTORY_FILTERS,
  filtersToSearchParams,
  parseRunHistoryFilters,
  runHistoryFiltersActive,
  type RunHistoryFilters,
} from "@/lib/runs/runHistoryFilters";
import { Button } from "@/components/ui/Button";
import { primarySegmentLeadingClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";

const FILTER_PANEL_SESSION_KEY = "runs-history-filters-open";

function readFilterPanelSessionOpen(): boolean {
  try {
    return sessionStorage.getItem(FILTER_PANEL_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFilterPanelSessionOpen(open: boolean) {
  try {
    if (open) sessionStorage.setItem(FILTER_PANEL_SESSION_KEY, "1");
    else sessionStorage.removeItem(FILTER_PANEL_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

type Option = { id: string; label: string };

type SessionsFilterBarProps = {
  cars: Option[];
  tracks: Option[];
  events: Option[];
  tireSets: Option[];
  teamId: string | null;
  focusRun: string | null;
  viewAll: boolean;
};

const controlClass =
  "rounded-md border border-border bg-background px-2.5 py-2 ui-control outline-none";
const labelClass = "ui-label-meta block";

function MultiSelect({
  label,
  options,
  selectedIds,
  onChange,
  className,
}: {
  label: string;
  options: Option[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const summary =
    selectedIds.length === 0
      ? `All ${label.toLowerCase()}`
      : selectedIds.length === 1
        ? options.find((o) => o.id === selectedIds[0])?.label ?? "1 selected"
        : `${selectedIds.length} selected`;

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  return (
    <div className={`relative ${className ?? ""}`}>
      <span className={labelClass}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`mt-1 flex w-full min-w-[8rem] items-center justify-between gap-2 text-left hover:bg-muted/40 ${controlClass}`}
      >
        <span className="truncate">{summary}</span>
        <span className="text-muted-foreground">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full min-w-[12rem] overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg">
            {options.length === 0 ? (
              <p className="px-1 py-1 ui-label-meta">None</p>
            ) : (
              options.map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 ui-control hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(opt.id)}
                    onChange={() => toggle(opt.id)}
                    className="rounded border-border"
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function SessionsFilterBar({
  cars,
  tracks,
  events,
  tireSets,
  teamId,
  focusRun,
  viewAll,
}: SessionsFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const filters = useMemo(() => {
    const raw: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((value, key) => {
      raw[key] = value;
    });
    return parseRunHistoryFilters(raw);
  }, [searchParams]);

  const pushFilters = useCallback(
    (next: RunHistoryFilters) => {
      const base: Record<string, string> = {};
      if (teamId) base.teamId = teamId;
      if (focusRun) base.focusRun = focusRun;
      if (viewAll || runHistoryFiltersActive(next)) base.viewAll = "1";
      const sp = filtersToSearchParams(next, base);
      const q = sp.toString();
      router.push(q ? `${pathname}?${q}` : pathname);
    },
    [router, pathname, teamId, focusRun, viewAll]
  );

  const patch = (partial: Partial<RunHistoryFilters>) => {
    pushFilters({ ...filters, ...partial });
  };

  const clearFilters = () => {
    pushFilters({ ...DEFAULT_RUN_HISTORY_FILTERS, layout: filters.layout, sort: filters.sort });
  };

  const filtersActive = runHistoryFiltersActive(filters);
  const [panelOpen, setPanelOpen] = useState(filtersActive);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const prevFiltersActive = useRef(filtersActive);

  useEffect(() => {
    if (!sessionHydrated) {
      setSessionHydrated(true);
      if (!filtersActive && readFilterPanelSessionOpen()) {
        setPanelOpen(true);
      }
      prevFiltersActive.current = filtersActive;
      return;
    }
    if (!prevFiltersActive.current && filtersActive) {
      setPanelOpen(true);
    }
    prevFiltersActive.current = filtersActive;
  }, [filtersActive, sessionHydrated]);

  const openPanel = () => {
    setPanelOpen(true);
    writeFilterPanelSessionOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    writeFilterPanelSessionOpen(false);
  };

  const togglePanel = () => {
    if (panelOpen) closePanel();
    else openPanel();
  };

  const filtersActiveExcludingQuery =
    filters.carIds.length > 0 ||
    filters.trackIds.length > 0 ||
    filters.tireSetIds.length > 0 ||
    Boolean(filters.eventId) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    Boolean(filters.sessionType) ||
    Boolean(filters.meetingSessionType) ||
    filters.bestLapMin != null ||
    filters.bestLapMax != null ||
    Boolean(filters.raceClass) ||
    filters.status !== "all";

  return (
    <div className="w-full min-w-0 space-y-2">
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="action-item-add-composite flex min-w-0 flex-1 items-stretch rounded-lg border border-border bg-card">
          <div className={primarySegmentLeadingClassName()} aria-hidden>
            <Search className="size-4" strokeWidth={2.5} />
          </div>
          <label htmlFor="sessions-search" className="sr-only">
            Search sessions
          </label>
          <input
            id="sessions-search"
            key={filters.q ?? ""}
            type="search"
            placeholder="Track, car, tires, notes…"
            className="min-w-0 flex-1 border-0 bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            defaultValue={filters.q ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                patch({ q: e.currentTarget.value.trim() || null });
              }
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim() || null;
              if (v !== filters.q) patch({ q: v });
            }}
          />
          <button
            type="button"
            onClick={togglePanel}
            aria-expanded={panelOpen}
            aria-label="Filters"
            className="tap-active relative inline-flex shrink-0 items-center justify-center rounded-l-none rounded-r-lg px-2.5 min-h-9 min-w-9 text-muted-foreground transition hover:text-foreground"
          >
            <SlidersHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
            {filtersActiveExcludingQuery ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
                aria-label="Advanced filters active"
              />
            ) : null}
          </button>
        </div>
        {filtersActive ? (
          <Button
            type="button"
            variant="outline"
            onClick={clearFilters}
            className="shrink-0 self-end sm:self-auto"
          >
            Clear
          </Button>
        ) : null}
      </div>

      {panelOpen ? (
        <CardPanel contentClassName="p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
        <MultiSelect
          label="Cars"
          options={cars}
          selectedIds={filters.carIds}
          onChange={(carIds) => patch({ carIds })}
        />
        <MultiSelect
          label="Tracks"
          options={tracks}
          selectedIds={filters.trackIds}
          onChange={(trackIds) => patch({ trackIds })}
        />
        <div className="space-y-1">
          <label className={labelClass}>From</label>
          <input
            type="date"
            className={`block ${controlClass}`}
            value={filters.dateFrom ?? ""}
            onChange={(e) => patch({ dateFrom: e.target.value || null })}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>To</label>
          <input
            type="date"
            className={`block ${controlClass}`}
            value={filters.dateTo ?? ""}
            onChange={(e) => patch({ dateTo: e.target.value || null })}
          />
        </div>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className={`hover:bg-muted/40 ${controlClass}`}
          >
            {advancedOpen ? "Fewer filters" : "More filters"}
          </button>
          <Button type="button" variant="outline" onClick={closePanel} aria-expanded={true}>
            Hide
          </Button>
        </div>
          </div>

          {advancedOpen ? (
            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <MultiSelect
            label="Tire sets"
            options={tireSets}
            selectedIds={filters.tireSetIds}
            onChange={(tireSetIds) => patch({ tireSetIds })}
          />
          <div className="space-y-1 min-w-[10rem]">
            <label className={labelClass}>Event</label>
            <select
              className={`w-full ${controlClass}`}
              value={filters.eventId ?? ""}
              onChange={(e) => patch({ eventId: e.target.value || null })}
            >
              <option value="">All events</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Session type</label>
            <select
              className={controlClass}
              value={filters.sessionType ?? ""}
              onChange={(e) =>
                patch({
                  sessionType:
                    e.target.value === "TESTING" || e.target.value === "RACE_MEETING"
                      ? e.target.value
                      : null,
                })
              }
            >
              <option value="">Any</option>
              <option value="TESTING">Testing</option>
              <option value="RACE_MEETING">Race meeting</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Meeting session</label>
            <select
              className={controlClass}
              value={filters.meetingSessionType ?? ""}
              onChange={(e) => patch({ meetingSessionType: e.target.value || null })}
            >
              <option value="">Any</option>
              <option value="PRACTICE">Practice</option>
              <option value="QUALIFYING">Qualifying</option>
              <option value="RACE">Race</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Race class</label>
            <input
              type="text"
              className={`w-28 ${controlClass}`}
              placeholder="e.g. 13.5"
              defaultValue={filters.raceClass ?? ""}
              onBlur={(e) => patch({ raceClass: e.target.value.trim() || null })}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Best lap min (s)</label>
            <input
              type="number"
              step="0.001"
              className={`w-28 ${controlClass}`}
              value={filters.bestLapMin ?? ""}
              onChange={(e) =>
                patch({
                  bestLapMin: e.target.value ? parseFloat(e.target.value) : null,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Best lap max (s)</label>
            <input
              type="number"
              step="0.001"
              className={`w-28 ${controlClass}`}
              value={filters.bestLapMax ?? ""}
              onChange={(e) =>
                patch({
                  bestLapMax: e.target.value ? parseFloat(e.target.value) : null,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Status</label>
            <select
              className={controlClass}
              value={filters.status}
              onChange={(e) =>
                patch({
                  status:
                    e.target.value === "draft" || e.target.value === "complete"
                      ? e.target.value
                      : "all",
                })
              }
            >
              <option value="all">All</option>
              <option value="complete">Complete</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Sort</label>
            <select
              className={controlClass}
              value={filters.sort}
              onChange={(e) =>
                patch({
                  sort:
                    e.target.value === "completed_asc" ||
                    e.target.value === "best_lap_asc" ||
                    e.target.value === "best_lap_desc"
                      ? e.target.value
                      : "completed_desc",
                })
              }
            >
              <option value="completed_desc">Time completed (newest)</option>
              <option value="completed_asc">Time completed (oldest)</option>
              <option value="best_lap_asc">Fastest lap</option>
              <option value="best_lap_desc">Slowest lap</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Layout</label>
            <select
              className={controlClass}
              value={filters.layout}
              onChange={(e) =>
                patch({ layout: e.target.value === "flat" ? "flat" : "grouped" })
              }
            >
              <option value="grouped">Grouped sessions</option>
              <option value="flat">Flat list</option>
            </select>
          </div>
            </div>
          ) : null}
        </CardPanel>
      ) : null}
    </div>
  );
}
