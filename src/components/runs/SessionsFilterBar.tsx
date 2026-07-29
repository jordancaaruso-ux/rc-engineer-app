"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, Search, SlidersHorizontal, User, Users, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_RUN_HISTORY_FILTERS,
  filtersToSearchParams,
  parseRunHistoryFilters,
  runHistoryFiltersActive,
  type RunHistoryFilters,
} from "@/lib/runs/runHistoryFilters";
import { OPEN_GROUP_PARAM } from "@/lib/runs/sessionsReturn";
import { Button } from "@/components/ui/Button";
import { CardPanel } from "@/components/ui/CardPanel";
import { AnchoredMenu } from "@/components/ui/AnchoredMenu";

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

type TeamOption = { id: string; name: string };

type SessionsFilterBarProps = {
  cars: Option[];
  tracks: Option[];
  events: Option[];
  /** Tire type identities (id = displayName-or-legacy-label; label may add a set count). */
  tireTypes: Option[];
  /** Setup parameter keys present across the loaded runs (id = setup key). */
  setupFields: Option[];
  /** Teams the driver belongs to — drives the scope segment fused into the search bar. */
  teams: TeamOption[];
  teamId: string | null;
  /** Run whose session group stays expanded while filters change. */
  openGroup: string | null;
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
  const wrapRef = useRef<HTMLDivElement>(null);
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
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <span className={labelClass}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`mt-1 flex w-full min-w-[8rem] items-center justify-between gap-2 text-left hover:bg-muted/40 ${controlClass}`}
      >
        <span className="truncate">{summary}</span>
        <span className="text-muted-foreground">{open ? "▴" : "▾"}</span>
      </button>
      <AnchoredMenu open={open} anchorRef={wrapRef} onClose={() => setOpen(false)}>
        <div className="max-h-48 w-full min-w-[12rem] overflow-y-auto rounded-md border border-border bg-card p-2 shadow-lg">
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
      </AnchoredMenu>
    </div>
  );
}

/**
 * Session scope — fused as the leading segment of the search bar (My sessions vs
 * a team). Replaces the old free-floating pill row above search. A hairline
 * divides it from the query field; the trigger opens a dropdown listing
 * `My sessions` + each team, or a muted "set up a team" hint when the driver has
 * none. Switching scope navigates to the bare route (dropping filters), matching
 * the previous behavior — no filter/query is threaded across scopes.
 */
function ScopeSegment({
  teams,
  activeTeamId,
}: {
  teams: TeamOption[];
  activeTeamId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasTeams = teams.length > 0;
  const scopeIsTeam = Boolean(activeTeamId);
  const activeTeam = teams.find((t) => t.id === activeTeamId) ?? null;
  const label = scopeIsTeam ? activeTeam?.name ?? "Team" : "My sessions";
  const TriggerIcon = scopeIsTeam ? Users : User;

  const go = (target: string) => {
    setOpen(false);
    router.push(target);
  };

  const itemClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-muted/50 ${
      active ? "text-foreground" : "text-muted-foreground"
    }`;

  return (
    <div ref={wrapRef} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Session scope: ${label}`}
        className="tap-active flex shrink-0 items-center gap-1.5 self-stretch rounded-l-lg border-r border-border py-1.5 pl-3 pr-2.5 text-xs font-semibold text-foreground transition hover:bg-muted/50"
      >
        <TriggerIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
        <span className="max-w-[7.5rem] truncate">{label}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2.2}
          aria-hidden
        />
      </button>
      <AnchoredMenu open={open} anchorRef={wrapRef} onClose={() => setOpen(false)} matchAnchorWidth={false}>
        <div
          role="menu"
          className="min-w-[13rem] rounded-md border border-border bg-card p-1.5 shadow-lg"
        >
            <p className="px-2 pb-1 pt-0.5 ui-label-meta">View</p>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!scopeIsTeam}
              className={itemClass(!scopeIsTeam)}
              onClick={() => go("/runs/history")}
            >
              <User className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
              <span className="min-w-0 truncate">My sessions</span>
              {!scopeIsTeam ? <Check className="ml-auto size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden /> : null}
            </button>
            {hasTeams ? (
              teams.map((t) => {
                const active = t.id === activeTeamId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={itemClass(active)}
                    onClick={() => go(`/runs/history?teamId=${encodeURIComponent(t.id)}`)}
                  >
                    <Users className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.9} aria-hidden />
                    <span className="min-w-0 truncate">{t.name}</span>
                    {active ? <Check className="ml-auto size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden /> : null}
                  </button>
                );
              })
            ) : (
              <>
                <div className="my-1 h-px bg-border" />
                <p className="px-2 py-1 ui-caption">See teammates’ runs once you’re on a team.</p>
                <button type="button" className={itemClass(false)} onClick={() => go("/teams")}>
                  <Users className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.9} aria-hidden />
                  <span className="min-w-0 truncate">Set up a team</span>
                </button>
              </>
            )}
        </div>
      </AnchoredMenu>
    </div>
  );
}

export function SessionsFilterBar({
  cars,
  tracks,
  events,
  tireTypes,
  setupFields,
  teams,
  teamId,
  openGroup,
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

  const [isPending, startTransition] = useTransition();

  const pushFilters = useCallback(
    (next: RunHistoryFilters, opts?: { replace?: boolean }) => {
      const base: Record<string, string> = {};
      if (teamId) base.teamId = teamId;
      if (openGroup) base[OPEN_GROUP_PARAM] = openGroup;
      if (viewAll || runHistoryFiltersActive(next)) base.viewAll = "1";
      const sp = filtersToSearchParams(next, base);
      const q = sp.toString();
      const url = q ? `${pathname}?${q}` : pathname;
      // Transition so `isPending` can surface "results updating" feedback.
      startTransition(() => {
        // Live-typing updates replace so Back doesn't step through every keystroke.
        if (opts?.replace) router.replace(url);
        else router.push(url);
      });
    },
    [router, pathname, teamId, openGroup, viewAll]
  );

  const patch = (partial: Partial<RunHistoryFilters>) => {
    pushFilters({ ...filters, ...partial });
  };

  // Live-as-you-type search: keep a local value for instant echo, and debounce
  // the URL push (each push is a server round-trip that re-runs the matcher).
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [queryText, setQueryText] = useState(filters.q ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sync local text when the query changes elsewhere (e.g. Clear, back button).
  const lastPushedQuery = useRef(filters.q ?? "");
  useEffect(() => {
    if ((filters.q ?? "") !== lastPushedQuery.current) {
      lastPushedQuery.current = filters.q ?? "";
      setQueryText(filters.q ?? "");
    }
  }, [filters.q]);

  const pushQuery = useCallback(
    (value: string) => {
      const next = value.trim() || null;
      if (next === (filtersRef.current.q ?? null)) return;
      lastPushedQuery.current = next ?? "";
      pushFilters({ ...filtersRef.current, q: next }, { replace: true });
    },
    [pushFilters]
  );

  const onQueryChange = (value: string) => {
    setQueryText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushQuery(value), 250);
  };

  const flushQuery = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushQuery(queryText);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const clearFilters = () => {
    pushFilters({ ...DEFAULT_RUN_HISTORY_FILTERS, layout: filters.layout, sort: filters.sort });
  };

  const filtersActive = runHistoryFiltersActive(filters);
  const filtersActiveExcludingQuery =
    filters.carIds.length > 0 ||
    filters.trackIds.length > 0 ||
    filters.tireTypes.length > 0 ||
    Boolean(filters.eventId) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    Boolean(filters.sessionType) ||
    Boolean(filters.meetingSessionType) ||
    filters.bestLapMin != null ||
    filters.bestLapMax != null ||
    Boolean(filters.raceClass) ||
    Boolean(filters.setupField) ||
    Boolean(filters.setupChangedField) ||
    filters.status !== "all";

  // The panel only auto-opens for structured filters (e.g. arriving via a
  // filtered URL) — never while typing a text query, which would be jarring.
  const [panelOpen, setPanelOpen] = useState(filtersActiveExcludingQuery);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const prevStructuredActive = useRef(filtersActiveExcludingQuery);

  useEffect(() => {
    if (!sessionHydrated) {
      setSessionHydrated(true);
      if (!filtersActiveExcludingQuery && readFilterPanelSessionOpen()) {
        setPanelOpen(true);
      }
      prevStructuredActive.current = filtersActiveExcludingQuery;
      return;
    }
    if (!prevStructuredActive.current && filtersActiveExcludingQuery) {
      setPanelOpen(true);
    }
    prevStructuredActive.current = filtersActiveExcludingQuery;
  }, [filtersActiveExcludingQuery, sessionHydrated]);

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

  // One chip per active filter so what's applied — and how to undo it — is
  // always visible without opening the panel.
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  const optionLabel = (options: Option[], id: string) =>
    options.find((o) => o.id === id)?.label ?? id;
  if (filters.q) {
    activeChips.push({ key: "q", label: `“${filters.q}”`, onRemove: () => patch({ q: null }) });
  }
  for (const id of filters.carIds) {
    activeChips.push({
      key: `car-${id}`,
      label: optionLabel(cars, id),
      onRemove: () => patch({ carIds: filters.carIds.filter((x) => x !== id) }),
    });
  }
  for (const id of filters.trackIds) {
    activeChips.push({
      key: `track-${id}`,
      label: optionLabel(tracks, id),
      onRemove: () => patch({ trackIds: filters.trackIds.filter((x) => x !== id) }),
    });
  }
  for (const id of filters.tireTypes) {
    activeChips.push({
      key: `tires-${id}`,
      // Chip shows the identity itself, not the "· N sets" dropdown label.
      label: id,
      onRemove: () => patch({ tireTypes: filters.tireTypes.filter((x) => x !== id) }),
    });
  }
  if (filters.eventId) {
    activeChips.push({
      key: "event",
      label: optionLabel(events, filters.eventId),
      onRemove: () => patch({ eventId: null }),
    });
  }
  if (filters.dateFrom || filters.dateTo) {
    activeChips.push({
      key: "dates",
      label: `${filters.dateFrom ?? "…"} → ${filters.dateTo ?? "…"}`,
      onRemove: () => patch({ dateFrom: null, dateTo: null }),
    });
  }
  if (filters.sessionType) {
    activeChips.push({
      key: "sessionType",
      label: filters.sessionType === "TESTING" ? "Testing" : "Race meeting",
      onRemove: () => patch({ sessionType: null }),
    });
  }
  if (filters.meetingSessionType) {
    activeChips.push({
      key: "meeting",
      label: filters.meetingSessionType.charAt(0) + filters.meetingSessionType.slice(1).toLowerCase(),
      onRemove: () => patch({ meetingSessionType: null }),
    });
  }
  if (filters.raceClass) {
    activeChips.push({
      key: "class",
      label: `Class ${filters.raceClass}`,
      onRemove: () => patch({ raceClass: null }),
    });
  }
  if (filters.bestLapMin != null || filters.bestLapMax != null) {
    activeChips.push({
      key: "laps",
      label: `Best ${filters.bestLapMin ?? "…"}–${filters.bestLapMax ?? "…"}s`,
      onRemove: () => patch({ bestLapMin: null, bestLapMax: null }),
    });
  }
  if (filters.setupField) {
    const fieldLabel = optionLabel(setupFields, filters.setupField);
    const condition =
      filters.setupOp === "between" && (filters.setupValue || filters.setupValue2)
        ? ` ${filters.setupValue ?? "…"}–${filters.setupValue2 ?? "…"}`
        : filters.setupValue
          ? ` ${filters.setupOp === "gte" ? "≥" : filters.setupOp === "lte" ? "≤" : "="} ${filters.setupValue}`
          : "";
    activeChips.push({
      key: "setupValue",
      label: `Setup: ${fieldLabel}${condition}`,
      onRemove: () =>
        patch({ setupField: null, setupOp: "eq", setupValue: null, setupValue2: null }),
    });
  }
  if (filters.setupChangedField) {
    const dirArrow =
      filters.setupChangedDir === "up" ? " ↑" : filters.setupChangedDir === "down" ? " ↓" : "";
    activeChips.push({
      key: "setupChanged",
      label: `Changed: ${optionLabel(setupFields, filters.setupChangedField)}${dirArrow}`,
      onRemove: () => patch({ setupChangedField: null, setupChangedDir: "any" }),
    });
  }
  if (filters.status !== "all") {
    activeChips.push({
      key: "status",
      label: filters.status === "draft" ? "Drafts" : "Complete",
      onRemove: () => patch({ status: "all" }),
    });
  }

  return (
    // `relative z-30` lifts the whole bar's stacking context above the session
    // list below it, so the scope/filter dropdowns (opaque menus) aren't
    // occluded by the later-sibling glass session cards painting over them.
    <div className="relative z-30 w-full min-w-0 space-y-2">
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="action-item-add-composite flex min-w-0 flex-1 items-stretch rounded-lg border border-border bg-card">
          <ScopeSegment teams={teams} activeTeamId={teamId} />
          <span className="flex shrink-0 items-center justify-center pl-2.5 pr-1 text-muted-foreground" aria-hidden>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2.5} />
            ) : (
              <Search className="size-4" strokeWidth={2.5} />
            )}
          </span>
          <label htmlFor="sessions-search" className="sr-only">
            Search sessions
          </label>
          <input
            id="sessions-search"
            type="search"
            placeholder="Track, car, tires, setup, notes…"
            className="min-w-0 flex-1 border-0 bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            value={queryText}
            onChange={(e) => onQueryChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                flushQuery();
              }
            }}
            onBlur={flushQuery}
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

      {activeChips.length > 0 ? (
        <div
          className={`flex flex-wrap items-center gap-1.5 transition-opacity ${isPending ? "opacity-60" : ""}`}
          aria-live="polite"
        >
          <span className="ui-label-meta shrink-0">
            {isPending ? "Updating…" : "Filtering by"}
          </span>
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs text-foreground"
            >
              <span className="min-w-0 truncate">{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.label}`}
                className="tap-active -mr-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2.5} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}

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
          <div className="space-y-1 min-w-[10rem]">
            <label className={labelClass}>Setup value</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                className={`min-w-[8rem] ${controlClass}`}
                value={filters.setupField ?? ""}
                onChange={(e) =>
                  patch({
                    setupField: e.target.value || null,
                    setupOp: "eq",
                    setupValue: null,
                    setupValue2: null,
                  })
                }
              >
                <option value="">Any field</option>
                {setupFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                className={`${controlClass} disabled:opacity-50`}
                disabled={!filters.setupField}
                value={filters.setupOp}
                aria-label="Setup value condition"
                onChange={(e) =>
                  patch({
                    setupOp:
                      e.target.value === "gte" ||
                      e.target.value === "lte" ||
                      e.target.value === "between"
                        ? e.target.value
                        : "eq",
                    setupValue2: null,
                  })
                }
              >
                <option value="eq">=</option>
                <option value="gte">≥</option>
                <option value="lte">≤</option>
                <option value="between">between</option>
              </select>
              <input
                type={filters.setupOp === "eq" ? "text" : "number"}
                step="any"
                className={`w-24 ${controlClass} disabled:opacity-50`}
                placeholder={filters.setupOp === "between" ? "min" : "value"}
                disabled={!filters.setupField}
                defaultValue={filters.setupValue ?? ""}
                key={`setupValue-${filters.setupField ?? "none"}-${filters.setupOp}-${filters.setupValue ?? ""}`}
                onBlur={(e) => patch({ setupValue: e.target.value.trim() || null })}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    patch({ setupValue: e.currentTarget.value.trim() || null });
                }}
              />
              {filters.setupOp === "between" ? (
                <input
                  type="number"
                  step="any"
                  className={`w-24 ${controlClass} disabled:opacity-50`}
                  placeholder="max"
                  disabled={!filters.setupField}
                  defaultValue={filters.setupValue2 ?? ""}
                  key={`setupValue2-${filters.setupField ?? "none"}-${filters.setupValue2 ?? ""}`}
                  onBlur={(e) => patch({ setupValue2: e.target.value.trim() || null })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      patch({ setupValue2: e.currentTarget.value.trim() || null });
                  }}
                />
              ) : null}
            </div>
          </div>
          <div className="space-y-1 min-w-[10rem]">
            <label className={labelClass}>Setup item changed</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                className={`min-w-[8rem] ${controlClass}`}
                value={filters.setupChangedField ?? ""}
                onChange={(e) =>
                  patch({ setupChangedField: e.target.value || null, setupChangedDir: "any" })
                }
              >
                <option value="">Any change</option>
                {setupFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                className={`${controlClass} disabled:opacity-50`}
                disabled={!filters.setupChangedField}
                value={filters.setupChangedDir}
                aria-label="Change direction"
                onChange={(e) =>
                  patch({
                    setupChangedDir:
                      e.target.value === "up" || e.target.value === "down"
                        ? e.target.value
                        : "any",
                  })
                }
              >
                <option value="any">any change</option>
                <option value="up">increased</option>
                <option value="down">decreased</option>
              </select>
            </div>
          </div>
          <MultiSelect
            label="Tire types"
            options={tireTypes}
            selectedIds={filters.tireTypes}
            onChange={(next) => patch({ tireTypes: next })}
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
