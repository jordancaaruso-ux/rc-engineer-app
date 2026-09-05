"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Loader2, Search, User, Users, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_RUN_HISTORY_FILTERS,
  filtersToSearchParams,
  parseRunHistoryFilters,
  runHistoryFiltersActive,
  type RunHistoryFilters,
} from "@/lib/runs/runHistoryFilters";
import {
  RUN_RATING_BAND_OPTIONS,
  normalizeRunRatingBandSlugs,
  runRatingBandCaption,
} from "@/lib/runHandlingAssessment";
import { OPEN_GROUP_PARAM } from "@/lib/runs/sessionsReturn";
import { AnchoredMenu } from "@/components/ui/AnchoredMenu";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { chipToggleClass } from "@/components/ui/chipToggle";

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
  /** Team roster as Driver options. Empty outside team scope — the pill hides there. */
  drivers: Option[];
  /** Teams the driver belongs to — drives the scope segment fused into the search bar. */
  teams: TeamOption[];
  teamId: string | null;
  /** Run whose session group stays expanded while filters change. */
  openGroup: string | null;
  viewAll: boolean;
};

/**
 * Every filter is a button on a row that is always on screen — there is no panel to
 * open, and nothing to discover. This replaced a 573px-tall form (1001px with its
 * advanced section open, on a 900px window) whose controls were only a fifth of its
 * area. The six filters below carry their own value in the button; the ten nobody
 * touches weekly live behind `More`, which is the only thing here that is still a
 * list of form fields.
 */
const POP_SURFACE =
  "max-w-[calc(100vw-1rem)] rounded-md border border-border bg-card p-2.5 shadow-lg";
/** Controls inside the More menu. Fixed height so selects and inputs line up. */
const POP_CONTROL =
  "h-8 w-full rounded border border-border bg-background px-2 ui-control outline-none";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Calendar date `days` ago, in the reader's own zone. The server windows runs in the
 * account's display zone, so a preset can land a day out for someone filtering across
 * midnight in another zone — the exact From/To boxes below the presets are the escape
 * hatch when that matters.
 */
function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function listSummary(options: Option[], ids: string[], plural: string): string | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) return options.find((o) => o.id === ids[0])?.label ?? ids[0];
  return `${ids.length} ${plural}`;
}

/**
 * One filter as a button that opens its own small menu. Skinned with
 * `chipToggleClass` so the row joins the same chip family as session type, handling
 * traits and tire compounds rather than inventing a fourth control idiom.
 */
function FilterPill({
  label,
  summary,
  menuClassName,
  children,
}: {
  label: string;
  /** Set when the filter is on; printed after the label and marks the pill active. */
  summary?: string | null;
  menuClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <PillTrigger label={label} summary={summary} open={open} onClick={() => setOpen((v) => !v)} />
      <AnchoredMenu
        open={open}
        anchorRef={wrapRef}
        onClose={() => setOpen(false)}
        matchAnchorWidth={false}
      >
        <div className={`${POP_SURFACE} ${menuClassName ?? "min-w-[13rem]"}`}>{children}</div>
      </AnchoredMenu>
    </div>
  );
}

/**
 * The chip every filter shows when closed. The summary is capped so a long car or
 * track name can't stretch one chip across the whole rail and push the others off
 * screen — the rail is a single row now and each chip has to stay chip-sized.
 */
function PillTrigger({
  label,
  summary,
  open,
  onClick,
}: {
  label: string;
  summary?: string | null;
  open: boolean;
  onClick: () => void;
}) {
  const active = Boolean(summary);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={active ? `${label}: ${summary}` : label}
      className={`tap-active flex max-w-[14rem] shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-xs ${chipToggleClass(
        active
      )}`}
    >
      <span className={active ? "shrink-0 text-muted-foreground" : "shrink-0"}>{label}</span>
      {active ? <span className="min-w-0 truncate font-semibold">{summary}</span> : null}
      <ChevronDown
        className={`size-3 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
        strokeWidth={2.4}
        aria-hidden
      />
    </button>
  );
}

/**
 * A set-valued filter (cars, tracks, tires, drivers) as a chip that opens the
 * app's picker sheet in multi-tick mode. These are the lists that grow without
 * bound — every track you've ever run — and the old anchored checkbox menu had no
 * search and a 14rem viewport, so a long list meant scrolling blind through a
 * little window. The sheet brings the search field past ten rows and the same
 * big rows as every other picker; ticks apply live, Done just closes it.
 */
function ListFilterPill({
  label,
  options,
  selectedIds,
  onChange,
  plural,
  clearLabel,
}: {
  label: string;
  options: Option[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** "cars", "tracks" — used in the chip summary once more than one is ticked. */
  plural: string;
  /** The sheet's top row: "Any car" clears the set. */
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const sections = useMemo(
    () => [{ key: "all", label: null, options: options.map((o) => ({ value: o.id, label: o.label })) }],
    [options]
  );
  const toggle = (id: string) => {
    if (id === "") {
      onChange([]);
      return;
    }
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    );
  };

  return (
    <>
      <PillTrigger
        label={label}
        summary={listSummary(options, selectedIds, plural)}
        open={open}
        onClick={() => setOpen(true)}
      />
      <PickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        value=""
        onSelect={toggle}
        sections={sections}
        clearRow={{ label: clearLabel }}
        searchPlaceholder={`Search ${plural}…`}
        multiple={{ values: selectedIds }}
      />
    </>
  );
}

/** Label-left / control-right row inside the More menu. `stacked` for composites. */
function PopRow({
  label,
  htmlFor,
  stacked,
  children,
}: {
  label: string;
  htmlFor?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  if (stacked) {
    return (
      <div className="space-y-1 py-1.5">
        <label className="ui-label-meta block" htmlFor={htmlFor}>
          {label}
        </label>
        {children}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[5.25rem_1fr] items-center gap-2 py-1.5">
      <label className="ui-label-meta" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function PopGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-border pt-1.5 first:border-t-0 first:pt-0">
      <p className="ui-label-meta pb-0.5 uppercase tracking-wide opacity-70">{title}</p>
      {children}
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
              {!scopeIsTeam ? <Check className="ml-auto size-4 shrink-0 text-primary-ink" strokeWidth={2.5} aria-hidden /> : null}
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
                    {active ? <Check className="ml-auto size-4 shrink-0 text-primary-ink" strokeWidth={2.5} aria-hidden /> : null}
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
  drivers,
  teams,
  teamId,
  openGroup,
  viewAll,
}: SessionsFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
    // Sort and layout change how results are shown, not which ones — Clear leaves them.
    pushFilters({ ...DEFAULT_RUN_HISTORY_FILTERS, layout: filters.layout, sort: filters.sort });
  };

  const filtersActive = runHistoryFiltersActive(filters);
  const showDriverPill = Boolean(teamId) && drivers.length > 0;

  // How many filters are hiding inside More, so a closed menu never holds something
  // you can't see. Best lap min+max count once — it reads as one filter.
  const moreFilterCount =
    (filters.eventId ? 1 : 0) +
    (filters.sessionType ? 1 : 0) +
    (filters.meetingSessionType ? 1 : 0) +
    (filters.raceClass ? 1 : 0) +
    (filters.bestLapMin != null || filters.bestLapMax != null ? 1 : 0) +
    (filters.setupField ? 1 : 0) +
    (filters.setupChangedField ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0);

  const ratingSummary =
    filters.ratingBands.length === 0
      ? null
      : filters.ratingBands.length === 1
        ? runRatingBandCaption(filters.ratingBands[0]!) ?? filters.ratingBands[0]!
        : `${filters.ratingBands.length} bands`;

  const dateSummary =
    filters.dateFrom && filters.dateTo
      ? `${shortDate(filters.dateFrom)} – ${shortDate(filters.dateTo)}`
      : filters.dateFrom
        ? `from ${shortDate(filters.dateFrom)}`
        : filters.dateTo
          ? `to ${shortDate(filters.dateTo)}`
          : null;

  const toggleBand = (slug: string) => {
    patch({
      ratingBands: filters.ratingBands.includes(slug)
        ? filters.ratingBands.filter((s) => s !== slug)
        : normalizeRunRatingBandSlugs([...filters.ratingBands, slug]),
    });
  };

  const setDatePreset = (days: number | null) => {
    patch(days == null ? { dateFrom: null, dateTo: null } : { dateFrom: ymdDaysAgo(days), dateTo: null });
  };

  // Chips only for what the pill row doesn't already show: the text query, and the
  // filters that live inside More. Duplicating a pill's own value here was noise.
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  const optionLabel = (options: Option[], id: string) =>
    options.find((o) => o.id === id)?.label ?? id;
  if (filters.q) {
    activeChips.push({ key: "q", label: `“${filters.q}”`, onRemove: () => patch({ q: null }) });
  }
  if (filters.eventId) {
    activeChips.push({
      key: "event",
      label: optionLabel(events, filters.eventId),
      onRemove: () => patch({ eventId: null }),
    });
  }
  if (filters.sessionType) {
    activeChips.push({
      key: "sessionType",
      label: filters.sessionType === "TESTING" ? "Testing" : "Event",
      onRemove: () => patch({ sessionType: null }),
    });
  }
  if (filters.meetingSessionType) {
    activeChips.push({
      key: "meeting",
      label:
        filters.meetingSessionType.charAt(0) + filters.meetingSessionType.slice(1).toLowerCase(),
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
        {/* `.action-item-add-composite` suppresses the inner input's own ring so the
            shell can own focus — but nothing was drawing that ring here, so the bar
            never looked focused. Applied locally, not on the shared class the
            dashboard action row also uses. */}
        <div className="action-item-add-composite flex min-w-0 flex-1 items-stretch rounded-lg border border-border bg-card transition has-[input:focus-visible]:border-ring/45 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/35">
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
        </div>
      </div>

      {/* One row, always. The rail scrolls sideways under the finger instead of
          wrapping, so six filters take the height of one chip at 390px; the negative
          margin lets it bleed to the screen edge the way the run rail does. Clear
          leads the row when anything is set — first, not last, because the end of a
          scrolling rail is the one place a phone can't see. */}
      <div
        className="run-rail-scroll -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        role="group"
        aria-label="Filters"
      >
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            aria-label="Clear filters"
            className={`tap-active flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-1.5 text-xs ${chipToggleClass(false)}`}
          >
            <X className="size-3" strokeWidth={2.6} aria-hidden />
            Clear
          </button>
        ) : null}

        <FilterPill label="Rating" summary={ratingSummary} menuClassName="w-[17.5rem]">
          <p className="ui-label-meta pb-1.5">Handling rating</p>
          <div className="flex flex-wrap gap-1.5">
            {RUN_RATING_BAND_OPTIONS.map((opt) => {
              const active = filters.ratingBands.includes(opt.slug);
              return (
                <button
                  key={opt.slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleBand(opt.slug)}
                  className={`tap-active px-2 py-1 text-xs ${chipToggleClass(active)}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </FilterPill>

        <ListFilterPill
          label="Cars"
          options={cars}
          selectedIds={filters.carIds}
          onChange={(carIds) => patch({ carIds })}
          plural="cars"
          clearLabel="Any car"
        />

        <ListFilterPill
          label="Tracks"
          options={tracks}
          selectedIds={filters.trackIds}
          onChange={(trackIds) => patch({ trackIds })}
          plural="tracks"
          clearLabel="Any track"
        />

        {showDriverPill ? (
          <ListFilterPill
            label="Driver"
            options={drivers}
            selectedIds={filters.driverIds}
            onChange={(driverIds) => patch({ driverIds })}
            plural="drivers"
            clearLabel="Any driver"
          />
        ) : null}

        <FilterPill label="Date" summary={dateSummary} menuClassName="w-[15rem]">
          <div className="flex flex-wrap gap-1.5 pb-2">
            {[
              { label: "Last 7 days", days: 7 },
              { label: "Last 30 days", days: 30 },
              { label: "Last 90 days", days: 90 },
              { label: "Any time", days: null },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setDatePreset(preset.days)}
                className={`tap-active px-2 py-1 text-xs ${chipToggleClass(
                  preset.days == null
                    ? !filters.dateFrom && !filters.dateTo
                    : filters.dateFrom === ymdDaysAgo(preset.days) && !filters.dateTo
                )}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[2.25rem_1fr] items-center gap-2 border-t border-border pt-2">
            <label className="ui-label-meta" htmlFor="sessions-date-from">
              From
            </label>
            <input
              id="sessions-date-from"
              type="date"
              className={POP_CONTROL}
              value={filters.dateFrom ?? ""}
              onChange={(e) => patch({ dateFrom: e.target.value || null })}
            />
            <label className="ui-label-meta" htmlFor="sessions-date-to">
              To
            </label>
            <input
              id="sessions-date-to"
              type="date"
              className={POP_CONTROL}
              value={filters.dateTo ?? ""}
              onChange={(e) => patch({ dateTo: e.target.value || null })}
            />
          </div>
        </FilterPill>

        <ListFilterPill
          label="Tires"
          options={tireTypes}
          selectedIds={filters.tireTypes}
          onChange={(next) => patch({ tireTypes: next })}
          plural="compounds"
          clearLabel="Any tire"
        />

        <FilterPill
          label="More"
          summary={moreFilterCount > 0 ? String(moreFilterCount) : null}
          menuClassName="w-[20rem] max-h-[70vh] overflow-y-auto"
        >
          <div className="space-y-1.5">
            <PopGroup title="Race">
              <PopRow label="Event" htmlFor="sessions-event">
                <select
                  id="sessions-event"
                  className={POP_CONTROL}
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
              </PopRow>
              <PopRow label="Type" htmlFor="sessions-session-type">
                <select
                  id="sessions-session-type"
                  className={POP_CONTROL}
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
                  <option value="RACE_MEETING">Event</option>
                </select>
              </PopRow>
              <PopRow label="Session" htmlFor="sessions-meeting-session">
                <select
                  id="sessions-meeting-session"
                  className={POP_CONTROL}
                  value={filters.meetingSessionType ?? ""}
                  onChange={(e) => patch({ meetingSessionType: e.target.value || null })}
                >
                  <option value="">Any</option>
                  <option value="PRACTICE">Practice</option>
                  <option value="QUALIFYING">Qualifying</option>
                  <option value="RACE">Race</option>
                  <option value="OTHER">Other</option>
                </select>
              </PopRow>
              <PopRow label="Class" htmlFor="sessions-race-class">
                <input
                  id="sessions-race-class"
                  type="text"
                  className={POP_CONTROL}
                  placeholder="e.g. 13.5"
                  defaultValue={filters.raceClass ?? ""}
                  onBlur={(e) => patch({ raceClass: e.target.value.trim() || null })}
                />
              </PopRow>
            </PopGroup>

            <PopGroup title="Pace & status">
              <PopRow label="Best lap">
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.001"
                    aria-label="Best lap minimum (s)"
                    placeholder="min"
                    className={POP_CONTROL}
                    value={filters.bestLapMin ?? ""}
                    onChange={(e) =>
                      patch({ bestLapMin: e.target.value ? parseFloat(e.target.value) : null })
                    }
                  />
                  <span className="shrink-0 ui-label-meta">–</span>
                  <input
                    type="number"
                    step="0.001"
                    aria-label="Best lap maximum (s)"
                    placeholder="max"
                    className={POP_CONTROL}
                    value={filters.bestLapMax ?? ""}
                    onChange={(e) =>
                      patch({ bestLapMax: e.target.value ? parseFloat(e.target.value) : null })
                    }
                  />
                </div>
              </PopRow>
              <PopRow label="Status" htmlFor="sessions-status">
                <select
                  id="sessions-status"
                  className={POP_CONTROL}
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
                  <option value="all">All runs</option>
                  <option value="complete">Complete</option>
                  <option value="draft">Draft</option>
                </select>
              </PopRow>
            </PopGroup>

            <PopGroup title="Setup">
              <PopRow label="Value is" stacked>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label="Setup field"
                    className={`${POP_CONTROL} min-w-[8rem] flex-1`}
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
                    className={`${POP_CONTROL} w-14 disabled:opacity-50`}
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
                    <option value="between">↔</option>
                  </select>
                  <input
                    type={filters.setupOp === "eq" ? "text" : "number"}
                    step="any"
                    aria-label={
                      filters.setupOp === "between" ? "Setup value minimum" : "Setup value"
                    }
                    className={`${POP_CONTROL} w-20 disabled:opacity-50`}
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
                      aria-label="Setup value maximum"
                      className={`${POP_CONTROL} w-20 disabled:opacity-50`}
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
              </PopRow>
              <PopRow label="Item changed" stacked>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label="Changed setup field"
                    className={`${POP_CONTROL} min-w-[8rem] flex-1`}
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
                    className={`${POP_CONTROL} w-28 disabled:opacity-50`}
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
                    <option value="any">any way</option>
                    <option value="up">increased</option>
                    <option value="down">decreased</option>
                  </select>
                </div>
              </PopRow>
            </PopGroup>

            <PopGroup title="View">
              <PopRow label="Sort" htmlFor="sessions-sort">
                <select
                  id="sessions-sort"
                  className={POP_CONTROL}
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
                  <option value="completed_desc">Newest first</option>
                  <option value="completed_asc">Oldest first</option>
                  <option value="best_lap_asc">Fastest lap</option>
                  <option value="best_lap_desc">Slowest lap</option>
                </select>
              </PopRow>
              <PopRow label="Layout" htmlFor="sessions-layout">
                <select
                  id="sessions-layout"
                  className={POP_CONTROL}
                  value={filters.layout}
                  onChange={(e) =>
                    patch({ layout: e.target.value === "flat" ? "flat" : "grouped" })
                  }
                >
                  <option value="grouped">Grouped sessions</option>
                  <option value="flat">Flat list</option>
                </select>
              </PopRow>
            </PopGroup>
          </div>
        </FilterPill>
      </div>

      {activeChips.length > 0 ? (
        <div
          className={`flex flex-wrap items-center gap-1.5 transition-opacity ${isPending ? "opacity-60" : ""}`}
          aria-live="polite"
        >
          <span className="ui-label-meta shrink-0">
            {isPending ? "Updating…" : "Also filtering by"}
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
    </div>
  );
}
