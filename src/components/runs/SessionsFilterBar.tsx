"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_RUN_HISTORY_FILTERS,
  filtersToSearchParams,
  parseRunHistoryFilters,
  runHistoryFiltersActive,
  type RunHistoryFilters,
} from "@/lib/runs/runHistoryFilters";

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

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1">
          <label className={labelClass} htmlFor="sessions-search">
            Search
          </label>
          <input
            id="sessions-search"
            type="search"
            placeholder="Track, car, tires, notes…"
            className={`w-full ${controlClass}`}
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
        </div>
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
          {filtersActive ? (
            <button
              type="button"
              onClick={clearFilters}
              className={`text-muted-foreground hover:bg-muted/40 ${controlClass}`}
            >
              Clear
            </button>
          ) : null}
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
    </div>
  );
}
