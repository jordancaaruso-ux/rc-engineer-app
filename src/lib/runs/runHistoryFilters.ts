import type { Prisma } from "@prisma/client";
import { formatGroupDate } from "@/lib/formatDate";
import { getBestLap, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatLocalCalendarDate } from "@/lib/runs/localCalendarInTimeZone";
import { normalizeSetupData } from "@/lib/runSetup";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";
import { isDocumentMetadataField } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { setupFieldLabel } from "@/lib/setupCompare/changedSincePrevious";
import { compareSetupField } from "@/lib/setupCompare/compare";
import {
  RUN_RATING_UNRATED_SLUG,
  carRatingsForBandSlugs,
  normalizeRunRatingBandSlugs,
  runRatingBandLabel,
} from "@/lib/runHandlingAssessment";

export type RunHistorySort = "completed_desc" | "completed_asc" | "best_lap_asc" | "best_lap_desc";
export type RunHistoryLayout = "grouped" | "flat";
export type RunHistoryStatus = "all" | "draft" | "complete";
/** Setup-value comparison. `eq` is contains-text; the rest compare parsed numbers. */
export type SetupValueOp = "eq" | "gte" | "lte" | "between";
/** Direction constraint for the setup-changed filter (numeric fields). */
export type SetupChangedDir = "any" | "up" | "down";

export type RunHistoryFilters = {
  q: string | null;
  carIds: string[];
  trackIds: string[];
  /** Tire *type* identities: `tireType.displayName` when linked, else the set's label (legacy sets). */
  tireTypes: string[];
  eventId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  sessionType: "TESTING" | "RACE_MEETING" | null;
  meetingSessionType: string | null;
  bestLapMin: number | null;
  bestLapMax: number | null;
  /**
   * Handling-rating bands to keep, as slugs from `RUN_RATING_BAND_OPTIONS`
   * (`bad` / `workable` / `good` / `dialled` / `unrated`). Empty = every rating.
   */
  ratingBands: string[];
  /**
   * Team scope only: narrow to these team members. Empty = the whole roster. Ignored
   * outside team scope, and always intersected with the caller's roster server-side —
   * never trusted as a standalone `userId` filter.
   */
  driverIds: string[];
  raceClass: string | null;
  /** Setup-value filter: setup field key to look for (e.g. `toe_front`). */
  setupField: string | null;
  setupOp: SetupValueOp;
  /** For `eq`: contains-text. For `gte`/`lte`: the bound. For `between`: the lower bound. */
  setupValue: string | null;
  /** For `between`: the upper bound. */
  setupValue2: string | null;
  /** Setup-change filter: keep only runs where this field changed vs the previous run on the same car. */
  setupChangedField: string | null;
  setupChangedDir: SetupChangedDir;
  status: RunHistoryStatus;
  sort: RunHistorySort;
  layout: RunHistoryLayout;
};

export const DEFAULT_RUN_HISTORY_FILTERS: RunHistoryFilters = {
  q: null,
  carIds: [],
  trackIds: [],
  tireTypes: [],
  eventId: null,
  dateFrom: null,
  dateTo: null,
  sessionType: null,
  meetingSessionType: null,
  bestLapMin: null,
  bestLapMax: null,
  ratingBands: [],
  driverIds: [],
  raceClass: null,
  setupField: null,
  setupOp: "eq",
  setupValue: null,
  setupValue2: null,
  setupChangedField: null,
  setupChangedDir: "any",
  status: "all",
  sort: "completed_desc",
  layout: "grouped",
};

type SearchParamValue = string | string[] | undefined;

function firstParam(v: SearchParamValue): string {
  if (Array.isArray(v)) return v[0]?.trim() ?? "";
  return typeof v === "string" ? v.trim() : "";
}

function parseIdList(raw: string): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

function parseOptionalFloat(raw: string): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function parseSessionType(raw: string): RunHistoryFilters["sessionType"] {
  const u = raw.toUpperCase();
  if (u === "TESTING") return "TESTING";
  if (u === "RACE_MEETING" || u === "RACE") return "RACE_MEETING";
  return null;
}

function parseSort(raw: string): RunHistorySort {
  if (raw === "completed_asc") return "completed_asc";
  if (raw === "best_lap_asc") return "best_lap_asc";
  if (raw === "best_lap_desc") return "best_lap_desc";
  return "completed_desc";
}

function parseStatus(raw: string): RunHistoryStatus {
  if (raw === "draft") return "draft";
  if (raw === "complete") return "complete";
  return "all";
}

function parseLayout(raw: string): RunHistoryLayout {
  return raw === "flat" ? "flat" : "grouped";
}

function parseSetupOp(raw: string): SetupValueOp {
  if (raw === "gte" || raw === "lte" || raw === "between") return raw;
  return "eq";
}

function parseSetupChangedDir(raw: string): SetupChangedDir {
  if (raw === "up" || raw === "down") return raw;
  return "any";
}

/** Tire-type identities are URI-encoded per item so names containing commas survive the list. */
function parseEncodedList(raw: string): string[] {
  return parseIdList(raw).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}

/** Merge legacy single-id params with multi-select lists. */
export function parseRunHistoryFilters(
  searchParams: Record<string, SearchParamValue>
): RunHistoryFilters {
  const q = firstParam(searchParams.q) || null;
  const carIds = [
    ...parseIdList(firstParam(searchParams.carIds)),
    ...(firstParam(searchParams.carId) ? [firstParam(searchParams.carId)] : []),
  ];
  const trackIds = [
    ...parseIdList(firstParam(searchParams.trackIds)),
    ...(firstParam(searchParams.trackId) ? [firstParam(searchParams.trackId)] : []),
  ];
  const tireTypes = parseEncodedList(firstParam(searchParams.tireTypes));
  const eventId = firstParam(searchParams.eventId) || null;
  const dateFrom = firstParam(searchParams.dateFrom) || null;
  const dateTo = firstParam(searchParams.dateTo) || null;
  const sessionType = parseSessionType(firstParam(searchParams.sessionType));
  const meetingSessionType = firstParam(searchParams.meetingSessionType) || null;
  const bestLapMin = parseOptionalFloat(firstParam(searchParams.bestLapMin));
  const bestLapMax = parseOptionalFloat(firstParam(searchParams.bestLapMax));
  const ratingBands = normalizeRunRatingBandSlugs(
    parseIdList(firstParam(searchParams.ratingBands))
  );
  const driverIds = parseIdList(firstParam(searchParams.driverIds));
  const raceClass = firstParam(searchParams.raceClass) || null;
  const setupField = firstParam(searchParams.setupField) || null;
  const setupOp = parseSetupOp(firstParam(searchParams.setupOp));
  const setupValue = firstParam(searchParams.setupValue) || null;
  const setupValue2 = firstParam(searchParams.setupValue2) || null;
  const setupChangedField = firstParam(searchParams.setupChangedField) || null;
  const setupChangedDir = parseSetupChangedDir(firstParam(searchParams.setupChangedDir));
  const status = parseStatus(firstParam(searchParams.status));
  const sort = parseSort(firstParam(searchParams.sort));
  const layout = parseLayout(firstParam(searchParams.layout));

  return {
    q,
    carIds: [...new Set(carIds)],
    trackIds: [...new Set(trackIds)],
    tireTypes,
    eventId,
    dateFrom,
    dateTo,
    sessionType,
    meetingSessionType,
    bestLapMin,
    bestLapMax,
    ratingBands,
    driverIds,
    raceClass,
    setupField,
    setupOp: setupField ? setupOp : "eq",
    // Values with no field to anchor them are meaningless — drop them.
    setupValue: setupField ? setupValue : null,
    setupValue2: setupField && setupOp === "between" ? setupValue2 : null,
    setupChangedField,
    setupChangedDir: setupChangedField ? setupChangedDir : "any",
    status,
    sort,
    layout,
  };
}

/**
 * How many *filters* are on, counted by group rather than by value — picking three cars
 * is one filter, not three. This is the number the Sessions bar prints on its Filters
 * button, and the single definition of "a filter is set".
 *
 * Deliberately excludes `q` (it has its own visible input, and the button would read
 * "Filters · 1" the moment you typed), and `sort`/`layout` (they change the view, not
 * which runs are in it — Clear leaves them alone).
 *
 * Add every new filter here. {@link runHistoryFiltersActive} is derived from this count,
 * so there is one list to keep up to date, not two.
 */
export function countActiveRunHistoryFilters(filters: RunHistoryFilters): number {
  let n = 0;
  if (filters.carIds.length > 0) n++;
  if (filters.trackIds.length > 0) n++;
  if (filters.driverIds.length > 0) n++;
  if (filters.tireTypes.length > 0) n++;
  if (filters.eventId) n++;
  if (filters.dateFrom) n++;
  if (filters.dateTo) n++;
  if (filters.sessionType) n++;
  if (filters.meetingSessionType) n++;
  if (filters.ratingBands.length > 0) n++;
  if (filters.bestLapMin != null) n++;
  if (filters.bestLapMax != null) n++;
  if (filters.raceClass) n++;
  if (filters.setupField) n++;
  if (filters.setupChangedField) n++;
  if (filters.status !== "all") n++;
  return n;
}

export function runHistoryFiltersActive(filters: RunHistoryFilters): boolean {
  return Boolean(filters.q) || countActiveRunHistoryFilters(filters) > 0;
}

/** Id → display name, for the filters whose values are ids rather than words. */
export type RunHistoryFilterOptions = {
  cars?: readonly { id: string; label: string }[];
  tracks?: readonly { id: string; label: string }[];
  events?: readonly { id: string; label: string }[];
  drivers?: readonly { id: string; label: string }[];
};

/**
 * The active filters as short human labels — "Blue compound", "Kingston", "Camber ≥ 1.5".
 *
 * The Sessions workbench shows a filtered *subset* of each session, so the pane says which
 * question you asked; without it a two-run session reads as the whole day. Pure and
 * server-safe (no handlers, no hooks) so the server page can render it — `SessionsFilterBar`
 * builds its own chips because each one also needs a remove handler.
 *
 * Order follows {@link countActiveRunHistoryFilters}; keep the two in step when adding a filter.
 * Ids that aren't in `options` fall back to the raw id rather than vanishing — a label you
 * can't read still tells you a filter is on.
 */
export function describeRunHistoryFilters(
  filters: RunHistoryFilters,
  options: RunHistoryFilterOptions = {}
): string[] {
  const out: string[] = [];
  const label = (opts: readonly { id: string; label: string }[] | undefined, id: string) =>
    opts?.find((o) => o.id === id)?.label ?? id;
  const list = (
    opts: readonly { id: string; label: string }[] | undefined,
    ids: string[],
    plural: string
  ) => (ids.length === 1 ? label(opts, ids[0]!) : `${ids.length} ${plural}`);
  // Calendar dates, not instants — formatted in UTC so a `YYYY-MM-DD` never slips a day
  // for a reader west of Greenwich.
  const day = (ymd: string) => formatGroupDate(ymd, "UTC");

  if (filters.q) out.push(`“${filters.q}”`);
  if (filters.carIds.length) out.push(list(options.cars, filters.carIds, "cars"));
  if (filters.trackIds.length) out.push(list(options.tracks, filters.trackIds, "tracks"));
  if (filters.driverIds.length) out.push(list(options.drivers, filters.driverIds, "drivers"));
  // Tire-type filter values ARE the identity strings, so they need no lookup.
  if (filters.tireTypes.length) {
    out.push(
      filters.tireTypes.length === 1
        ? filters.tireTypes[0]!
        : `${filters.tireTypes.length} compounds`
    );
  }
  if (filters.eventId) out.push(label(options.events, filters.eventId));
  if (filters.dateFrom && filters.dateTo) {
    // Compact the shared tail the way event date ranges do — the ribbon is one
    // truncating line, and "1 Jul 2026 – 31 Jul 2026" says July twice.
    const sameMonth = filters.dateFrom.slice(0, 7) === filters.dateTo.slice(0, 7);
    const from = sameMonth ? String(Number(filters.dateFrom.slice(8, 10))) : day(filters.dateFrom);
    out.push(`${from} – ${day(filters.dateTo)}`);
  } else if (filters.dateFrom) out.push(`From ${day(filters.dateFrom)}`);
  else if (filters.dateTo) out.push(`Until ${day(filters.dateTo)}`);
  if (filters.sessionType) {
    out.push(filters.sessionType === "TESTING" ? "Testing" : "Events");
  }
  if (filters.meetingSessionType) {
    const raw = filters.meetingSessionType;
    out.push(raw.charAt(0) + raw.slice(1).toLowerCase());
  }
  if (filters.ratingBands.length) {
    out.push(
      filters.ratingBands.length === 1
        ? runRatingBandLabel(filters.ratingBands[0]!) ?? filters.ratingBands[0]!
        : `${filters.ratingBands.length} ratings`
    );
  }
  if (filters.bestLapMin != null || filters.bestLapMax != null) {
    out.push(`Best ${filters.bestLapMin ?? "…"}–${filters.bestLapMax ?? "…"}s`);
  }
  if (filters.raceClass) out.push(`Class ${filters.raceClass}`);
  if (filters.setupField) {
    const field = setupFieldLabel(filters.setupField);
    const condition =
      filters.setupOp === "between" && (filters.setupValue || filters.setupValue2)
        ? ` ${filters.setupValue ?? "…"}–${filters.setupValue2 ?? "…"}`
        : filters.setupValue
          ? ` ${filters.setupOp === "gte" ? "≥" : filters.setupOp === "lte" ? "≤" : "="} ${filters.setupValue}`
          : "";
    out.push(`${field}${condition}`);
  }
  if (filters.setupChangedField) {
    const field = setupFieldLabel(filters.setupChangedField);
    const dir =
      filters.setupChangedDir === "up"
        ? " increased"
        : filters.setupChangedDir === "down"
          ? " decreased"
          : " changed";
    out.push(`${field}${dir}`);
  }
  if (filters.status !== "all") out.push(filters.status === "draft" ? "Drafts" : "Complete");
  return out;
}

export function filtersToSearchParams(
  filters: RunHistoryFilters,
  base: Record<string, string> = {}
): URLSearchParams {
  const sp = new URLSearchParams(base);
  const setOrDelete = (key: string, value: string | null) => {
    if (value) sp.set(key, value);
    else sp.delete(key);
  };

  setOrDelete("q", filters.q);
  setOrDelete("carIds", filters.carIds.length ? filters.carIds.join(",") : null);
  setOrDelete("trackIds", filters.trackIds.length ? filters.trackIds.join(",") : null);
  setOrDelete(
    "tireTypes",
    filters.tireTypes.length ? filters.tireTypes.map(encodeURIComponent).join(",") : null
  );
  setOrDelete("eventId", filters.eventId);
  setOrDelete("dateFrom", filters.dateFrom);
  setOrDelete("dateTo", filters.dateTo);
  setOrDelete("sessionType", filters.sessionType);
  setOrDelete("meetingSessionType", filters.meetingSessionType);
  setOrDelete("bestLapMin", filters.bestLapMin != null ? String(filters.bestLapMin) : null);
  setOrDelete("bestLapMax", filters.bestLapMax != null ? String(filters.bestLapMax) : null);
  setOrDelete("ratingBands", filters.ratingBands.length ? filters.ratingBands.join(",") : null);
  setOrDelete("driverIds", filters.driverIds.length ? filters.driverIds.join(",") : null);
  setOrDelete("raceClass", filters.raceClass);
  setOrDelete("setupField", filters.setupField);
  setOrDelete("setupOp", filters.setupField && filters.setupOp !== "eq" ? filters.setupOp : null);
  setOrDelete("setupValue", filters.setupField ? filters.setupValue : null);
  setOrDelete(
    "setupValue2",
    filters.setupField && filters.setupOp === "between" ? filters.setupValue2 : null
  );
  setOrDelete("setupChangedField", filters.setupChangedField);
  setOrDelete(
    "setupChangedDir",
    filters.setupChangedField && filters.setupChangedDir !== "any" ? filters.setupChangedDir : null
  );
  setOrDelete("status", filters.status !== "all" ? filters.status : null);
  setOrDelete("sort", filters.sort !== "completed_desc" ? filters.sort : null);
  setOrDelete("layout", filters.layout !== "grouped" ? filters.layout : null);

  sp.delete("carId");
  sp.delete("trackId");

  return sp;
}

/** Append a clause to `where.AND`, preserving whatever the caller's baseWhere already had. */
function andClause(where: Prisma.RunWhereInput, clause: Prisma.RunWhereInput): void {
  where.AND = Array.isArray(where.AND)
    ? [...where.AND, clause]
    : where.AND
      ? [where.AND, clause]
      : [clause];
}

/**
 * Note on scope: this never sets `userId`. Which drivers a viewer may see is the
 * caller's `baseWhere` to decide (solo = own id, team = the roster), and the
 * `driverIds` filter is applied there by intersecting with that roster. Setting
 * `userId` here would let a URL parameter widen the scope.
 */
export function buildRunHistoryPrismaWhere(
  filters: RunHistoryFilters,
  baseWhere: Prisma.RunWhereInput
): Prisma.RunWhereInput {
  const where: Prisma.RunWhereInput = { ...baseWhere };
  if (filters.carIds.length) where.carId = { in: filters.carIds };
  if (filters.trackIds.length) where.trackId = { in: filters.trackIds };
  if (filters.tireTypes.length) {
    // Identity is the compound. Legacy runs reach it through the set they went out on.
    // Nested under AND so it composes with whatever the caller's baseWhere already has.
    andClause(where, {
      OR: [
        { tireType: { displayName: { in: filters.tireTypes } } },
        { tireSet: { tireType: { displayName: { in: filters.tireTypes } } } },
      ],
    });
  }
  if (filters.ratingBands.length) {
    // carRating is a scalar column with an index, so the bands filter server-side.
    // "Unrated" is a real choice here: drafts and legacy runs have no number at all.
    const or: Prisma.RunWhereInput[] = [];
    const ratings = carRatingsForBandSlugs(filters.ratingBands);
    if (ratings.length) or.push({ carRating: { in: ratings } });
    if (filters.ratingBands.includes(RUN_RATING_UNRATED_SLUG)) or.push({ carRating: null });
    if (or.length) andClause(where, or.length === 1 ? or[0]! : { OR: or });
  }
  if (filters.eventId) where.eventId = filters.eventId;
  if (filters.sessionType) where.sessionType = filters.sessionType;
  if (filters.meetingSessionType) {
    where.meetingSessionType = { equals: filters.meetingSessionType, mode: "insensitive" };
  }
  if (filters.raceClass) {
    where.raceClass = { contains: filters.raceClass, mode: "insensitive" };
  }
  if (filters.status === "draft") where.loggingComplete = false;
  if (filters.status === "complete") where.loggingComplete = true;
  return where;
}

export type RunForHistoryFilter = {
  id?: string;
  /** Owning driver. Only used in team scope, to search by teammate name. */
  userId?: string | null;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  loggingCompletedAt: Date | null;
  sortAt: Date | null;
  bestLapSeconds: number | null;
  lapTimes: unknown;
  lapSession?: unknown;
  sessionLabel: string | null;
  raceClass: string | null;
  notes: string | null;
  driverNotes: string | null;
  handlingProblems: string | null;
  car?: { name: string } | null;
  carId?: string | null;
  carNameSnapshot: string | null;
  track?: { name: string } | null;
  trackNameSnapshot: string | null;
  event?: { name: string } | null;
  tireType?: { displayName: string } | null;
  tireRunNumber?: number | null;
  tireAgeKnown?: boolean | null;
  additiveType?: { displayName: string } | null;
  handlingAssessmentJson?: unknown;
  /** Setup parameters JSON; may be attached inline or supplied via `setupDataByRunId`. */
  setupSnapshot?: { id?: string; data?: unknown } | null;
  importedLapSets?: Array<{
    driverName?: string | null;
    displayName?: string | null;
    surname?: string | null;
    isPrimaryUser?: boolean;
  }>;
};

/** A single reason a run matched the active search/setup filters, shown in the UI. */
export type MatchReasonKind =
  | "car"
  | "track"
  | "event"
  | "session"
  | "class"
  | "tires"
  | "additive"
  | "driver"
  | "note"
  | "setup"
  | "changed";

export type MatchReason = { kind: MatchReasonKind; text: string };

/** Old → new values for one setup key that changed vs the previous run. */
export type SetupChangedDelta = { prev: unknown; cur: unknown };

/** Extra inputs the matcher needs that aren't always attached to the run row itself. */
export type RunHistoryMatchOptions = {
  /** runId → setup parameters JSON (preferred over `run.setupSnapshot.data` when present). */
  setupDataByRunId?: Map<string, unknown>;
  /** runId → changed setup keys (with old/new values) vs the previous run on the same car. */
  changedKeysByRunId?: Map<string, Map<string, SetupChangedDelta>>;
  /**
   * Team scope only: userId → display label. Lets free-text search match a teammate's
   * name, which is the first thing anyone tries before finding the Driver filter.
   */
  memberLabelByUserId?: Record<string, string>;
};

function runBestLapSeconds(run: RunForHistoryFilter): number | null {
  if (run.bestLapSeconds != null && Number.isFinite(run.bestLapSeconds)) return run.bestLapSeconds;
  return getBestLap(primaryLapRowsFromRun(run));
}

function resolveSetupData(run: RunForHistoryFilter, opts?: RunHistoryMatchOptions): unknown {
  if (opts?.setupDataByRunId && run.id) {
    const d = opts.setupDataByRunId.get(run.id);
    if (d !== undefined) return d;
  }
  return run.setupSnapshot?.data;
}

// ---------------------------------------------------------------------------
// Smart text search: tokenized AND across fields, typo tolerance, synonyms.
// ---------------------------------------------------------------------------

/**
 * Bidirectional synonym groups. Each token expands to include every other word
 * in its group so e.g. searching "wet" also finds notes that say "damp"/"rain".
 * Kept intentionally small and RC-setup specific; extend deliberately.
 */
const SYNONYM_GROUPS: string[][] = [
  ["wet", "damp", "rain", "rainy", "raining"],
  ["dry", "dusty"],
  ["hot", "warm", "heat"],
  ["cold", "cool", "chilly"],
  ["understeer", "push", "pushing", "tight", "understeering"],
  ["oversteer", "loose", "spin", "spinning", "oversteering"],
  ["grip", "traction", "grippy"],
  ["low-grip", "greasy", "slippery", "slick"],
  ["qualifying", "quals", "qual", "q"],
  ["practice", "prac"],
  ["race", "final", "main"],
  ["motor", "engine"],
];

const SYNONYM_LOOKUP: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    for (const word of group) {
      const set = map.get(word) ?? new Set<string>();
      for (const other of group) set.add(other);
      map.set(word, set);
    }
  }
  return map;
})();

function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Cheap capped Levenshtein — returns a distance, bailing out once it exceeds `max`. */
function levenshteinWithin(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Typo tolerance thresholds: none for very short tokens, 1 for medium, 2 for long. */
function fuzzyThresholdFor(token: string): number {
  if (token.length <= 3) return 0;
  if (token.length <= 6) return 1;
  return 2;
}

/**
 * Does `token` (or one of its synonyms) occur in `fieldText`?
 * Direct substring first (fast, covers most cases); then a word-level fuzzy
 * pass so single-character typos still hit.
 */
function tokenHitsField(token: string, fieldText: string): boolean {
  const variants = SYNONYM_LOOKUP.get(token);
  const needles = variants ? [token, ...variants] : [token];
  for (const needle of needles) {
    if (fieldText.includes(needle)) return true;
  }
  const threshold = fuzzyThresholdFor(token);
  if (threshold === 0) return false;
  const words = fieldText.split(/[^a-z0-9.]+/i).filter(Boolean);
  for (const word of words) {
    if (word.startsWith(token)) return true;
    if (levenshteinWithin(token, word, threshold) <= threshold) return true;
  }
  return false;
}

type SearchField = { kind: MatchReasonKind; text: string; label?: string; value?: string };

function pushField(
  fields: SearchField[],
  kind: MatchReasonKind,
  text: string | null | undefined,
  extra?: { label?: string; value?: string }
) {
  const t = text?.trim();
  if (t) fields.push({ kind, text: t, ...extra });
}

/** Everything about a run that free-text search can match against. */
function runSearchFields(
  run: RunForHistoryFilter,
  setupData: unknown,
  opts?: RunHistoryMatchOptions
): SearchField[] {
  const fields: SearchField[] = [];
  if (run.userId && opts?.memberLabelByUserId) {
    pushField(fields, "driver", opts.memberLabelByUserId[run.userId]);
  }
  pushField(fields, "car", run.car?.name);
  pushField(fields, "car", run.carNameSnapshot);
  pushField(fields, "track", run.track?.name);
  pushField(fields, "track", run.trackNameSnapshot);
  pushField(fields, "event", run.event?.name);
  pushField(fields, "session", run.sessionLabel);
  pushField(fields, "class", run.raceClass);
  if (run.tireType) {
    const wear = run.tireRunNumber != null && run.tireRunNumber > 0 ? ` run ${run.tireRunNumber}` : "";
    pushField(fields, "tires", `${run.tireType.displayName}${wear}`);
  }
  pushField(fields, "additive", run.additiveType?.displayName);
  for (const set of run.importedLapSets ?? []) {
    if (set.isPrimaryUser) continue;
    pushField(fields, "driver", set.displayName || set.driverName || set.surname || null);
  }
  pushField(fields, "note", run.notes);
  pushField(fields, "note", run.driverNotes);
  pushField(fields, "note", run.handlingProblems);
  pushField(fields, "note", handlingAssessmentText(run.handlingAssessmentJson));

  const obj = normalizeSetupData(setupData);
  for (const key of Object.keys(obj)) {
    // Sheet header/context fields (track, race, date, …) duplicate run-level
    // data and would make e.g. a track-name query hit every setup carried over
    // from that track. Free text only searches real setup parameters.
    if (isDocumentMetadataField(key)) continue;
    const raw = obj[key];
    if (raw == null) continue;
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (!value.trim()) continue;
    const label = setupFieldLabel(key);
    pushField(fields, "setup", `${label} ${value}`, { label, value });
  }
  return fields;
}

/** Flatten a handling-assessment JSON blob into a searchable string (best-effort). */
function handlingAssessmentText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string") {
      parts.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (typeof v === "object") {
      for (const val of Object.values(v as Record<string, unknown>)) walk(val);
    }
  };
  walk(json);
  return parts.join(" ").trim() || null;
}

/** Short snippet around the first matched token, for note fields. */
function snippetAround(text: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const token of tokens) {
    const at = lower.indexOf(token);
    if (at >= 0 && (idx < 0 || at < idx)) idx = at;
  }
  if (idx < 0) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  const start = Math.max(0, idx - 24);
  const end = Math.min(text.length, idx + 36);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

type TextMatchResult = { matched: boolean; reasons: MatchReason[] };

/**
 * Tokenized AND match: every token must hit some field. Returns compact,
 * deduped reasons describing which fields explained the match.
 */
function matchTextQuery(
  run: RunForHistoryFilter,
  q: string,
  setupData: unknown,
  opts?: RunHistoryMatchOptions
): TextMatchResult {
  const tokens = tokenizeQuery(q);
  if (tokens.length === 0) return { matched: true, reasons: [] };
  const fields = runSearchFields(run, setupData, opts).map((f) => ({
    ...f,
    lower: f.text.toLowerCase(),
  }));

  const matchedFields = new Set<(typeof fields)[number]>();
  for (const token of tokens) {
    let tokenHit = false;
    for (const field of fields) {
      if (tokenHitsField(token, field.lower)) {
        tokenHit = true;
        matchedFields.add(field);
      }
    }
    if (!tokenHit) return { matched: false, reasons: [] };
  }

  const reasons: MatchReason[] = [];
  const seen = new Set<string>();
  for (const field of matchedFields) {
    const text = field.kind === "note" ? snippetAround(field.text, tokens) : field.text;
    const key = `${field.kind}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reasons.push({ kind: field.kind, text });
  }
  return { matched: true, reasons: reasons.slice(0, 5) };
}

/** Numeric read of a stored setup value ("500cst" → 500, "-2,0°" → -2). */
function setupValueAsNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (Array.isArray(raw)) return null;
  return parseNumericFromSetupString(raw);
}

/**
 * Setup-value filter. `eq` keeps contains-text semantics; `gte`/`lte`/`between`
 * parse the stored value numerically and skip runs where no number can be read.
 * Bounds left empty degrade gracefully (a bound-less op = "field has any value").
 */
function matchSetupValue(
  filters: RunHistoryFilters,
  setupData: unknown
): { matched: boolean; reason: MatchReason | null } {
  if (!filters.setupField) return { matched: true, reason: null };
  const obj = normalizeSetupData(setupData);
  const raw = obj[filters.setupField];
  if (raw == null) return { matched: false, reason: null };
  const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
  if (!value.trim()) return { matched: false, reason: null };

  if (filters.setupOp === "eq") {
    const wanted = filters.setupValue?.trim().toLowerCase();
    if (wanted && !value.toLowerCase().includes(wanted)) {
      return { matched: false, reason: null };
    }
  } else {
    const lower =
      filters.setupOp === "lte" ? null : parseOptionalFloat(filters.setupValue ?? "");
    const upper =
      filters.setupOp === "gte"
        ? null
        : parseOptionalFloat(
            (filters.setupOp === "between" ? filters.setupValue2 : filters.setupValue) ?? ""
          );
    if (lower != null || upper != null) {
      const n = setupValueAsNumber(raw);
      if (n == null) return { matched: false, reason: null };
      if (lower != null && n < lower) return { matched: false, reason: null };
      if (upper != null && n > upper) return { matched: false, reason: null };
    }
  }

  const label = setupFieldLabel(filters.setupField);
  return { matched: true, reason: { kind: "setup", text: `${label} ${value}` } };
}

function formatChangedValue(raw: unknown): string {
  if (raw == null) return "—";
  const s = Array.isArray(raw) ? raw.join(", ") : String(raw);
  return s.trim() || "—";
}

/**
 * Setup-change filter: run must have changed `setupChangedField` vs the previous
 * run on its car; `up`/`down` additionally require both values to parse as
 * numbers and to have moved in that direction.
 */
function matchSetupChanged(
  run: RunForHistoryFilter,
  filters: RunHistoryFilters,
  opts?: RunHistoryMatchOptions
): { matched: boolean; reason: MatchReason | null } {
  if (!filters.setupChangedField) return { matched: true, reason: null };
  const changed = run.id ? opts?.changedKeysByRunId?.get(run.id) : undefined;
  const delta = changed?.get(filters.setupChangedField);
  if (!delta) return { matched: false, reason: null };
  if (filters.setupChangedDir !== "any") {
    const prevN = setupValueAsNumber(delta.prev);
    const curN = setupValueAsNumber(delta.cur);
    if (prevN == null || curN == null) return { matched: false, reason: null };
    if (filters.setupChangedDir === "up" && !(curN > prevN)) return { matched: false, reason: null };
    if (filters.setupChangedDir === "down" && !(curN < prevN)) return { matched: false, reason: null };
  }
  const label = setupFieldLabel(filters.setupChangedField);
  return {
    matched: true,
    reason: {
      kind: "changed",
      text: `${label} ${formatChangedValue(delta.prev)} → ${formatChangedValue(delta.cur)}`,
    },
  };
}

/** Full per-run evaluation: keep decision + accumulated match reasons. */
function evaluateRun(
  run: RunForHistoryFilter,
  filters: RunHistoryFilters,
  timeZone: string,
  opts?: RunHistoryMatchOptions
): { keep: boolean; reasons: MatchReason[] } {
  const reasons: MatchReason[] = [];
  if (!runInDateWindow(run, filters.dateFrom, filters.dateTo, timeZone)) {
    return { keep: false, reasons };
  }
  const setupData = resolveSetupData(run, opts);

  if (filters.q) {
    const text = matchTextQuery(run, filters.q, setupData, opts);
    if (!text.matched) return { keep: false, reasons };
    reasons.push(...text.reasons);
  }

  const setupVal = matchSetupValue(filters, setupData);
  if (!setupVal.matched) return { keep: false, reasons };
  if (setupVal.reason) reasons.push(setupVal.reason);

  const setupChanged = matchSetupChanged(run, filters, opts);
  if (!setupChanged.matched) return { keep: false, reasons };
  if (setupChanged.reason) reasons.push(setupChanged.reason);

  const best = runBestLapSeconds(run);
  if (filters.bestLapMin != null && (best == null || best < filters.bestLapMin)) {
    return { keep: false, reasons };
  }
  if (filters.bestLapMax != null && (best == null || best > filters.bestLapMax)) {
    return { keep: false, reasons };
  }
  return { keep: true, reasons };
}

/**
 * Compute, per run, which setup keys changed vs the previous (older) run on the
 * same car — the same "Setup vs previous run" semantics shown in run details.
 * Runs may arrive in any order; ordering is derived from the display instant.
 */
export function computeChangedKeysByRun<T extends RunForHistoryFilter>(
  runs: T[],
  opts?: RunHistoryMatchOptions
): Map<string, Map<string, SetupChangedDelta>> {
  const result = new Map<string, Map<string, SetupChangedDelta>>();
  const byCar = new Map<string, T[]>();
  for (const run of runs) {
    if (!run.id) continue;
    const carKey = run.carId ?? "__no_car__";
    const list = byCar.get(carKey) ?? [];
    list.push(run);
    byCar.set(carKey, list);
  }
  for (const [, list] of byCar) {
    // Oldest → newest so each run compares to the one before it.
    const ordered = [...list].sort(
      (a, b) => resolveRunDisplayInstant(a).getTime() - resolveRunDisplayInstant(b).getTime()
    );
    for (let i = 1; i < ordered.length; i++) {
      const cur = ordered[i]!;
      const prev = ordered[i - 1]!;
      const curData = normalizeSetupData(resolveSetupData(cur, opts));
      const prevData = normalizeSetupData(resolveSetupData(prev, opts));
      const keys = new Set([...Object.keys(curData), ...Object.keys(prevData)]);
      const changed = new Map<string, SetupChangedDelta>();
      for (const key of keys) {
        const cmp = compareSetupField({
          key,
          a: curData[key],
          b: prevData[key],
          numericAggregationByKey: null,
        });
        if (!cmp.areEqual) changed.set(key, { prev: prevData[key], cur: curData[key] });
      }
      if (cur.id && changed.size > 0) result.set(cur.id, changed);
    }
  }
  return result;
}

export function applyRunHistoryPostFilters<T extends RunForHistoryFilter>(
  runs: T[],
  filters: RunHistoryFilters,
  timeZone: string,
  opts?: RunHistoryMatchOptions
): T[] {
  return runs.filter((run) => evaluateRun(run, filters, timeZone, opts).keep);
}

/** Like {@link applyRunHistoryPostFilters} but also returns per-run match reasons. */
export function applyRunHistoryPostFiltersWithReasons<T extends RunForHistoryFilter>(
  runs: T[],
  filters: RunHistoryFilters,
  timeZone: string,
  opts?: RunHistoryMatchOptions
): { runs: T[]; reasonsById: Map<string, MatchReason[]> } {
  const kept: T[] = [];
  const reasonsById = new Map<string, MatchReason[]>();
  const explain = Boolean(filters.q || filters.setupField || filters.setupChangedField);
  for (const run of runs) {
    const { keep, reasons } = evaluateRun(run, filters, timeZone, opts);
    if (!keep) continue;
    kept.push(run);
    if (explain && run.id && reasons.length > 0) reasonsById.set(run.id, reasons);
  }
  return { runs: kept, reasonsById };
}

function runInDateWindow(
  run: RunForHistoryFilter,
  dateFrom: string | null,
  dateTo: string | null,
  timeZone: string
): boolean {
  if (!dateFrom && !dateTo) return true;
  const ymd = formatLocalCalendarDate(
    resolveRunDisplayInstant({
      createdAt: run.createdAt,
      sessionCompletedAt: run.sessionCompletedAt,
      loggingCompletedAt: run.loggingCompletedAt,
      sortAt: run.sortAt,
    }),
    timeZone
  );
  if (dateFrom && ymd < dateFrom) return false;
  if (dateTo && ymd > dateTo) return false;
  return true;
}

export function sortRunsForHistory<T extends RunForHistoryFilter>(
  runs: T[],
  sort: RunHistorySort
): T[] {
  const out = [...runs];
  if (sort === "completed_asc") {
    out.sort(
      (a, b) =>
        resolveRunDisplayInstant(a).getTime() - resolveRunDisplayInstant(b).getTime()
    );
    return out;
  }
  if (sort === "best_lap_asc") {
    out.sort((a, b) => {
      const la = runBestLapSeconds(a);
      const lb = runBestLapSeconds(b);
      if (la == null && lb == null) return 0;
      if (la == null) return 1;
      if (lb == null) return -1;
      return la - lb;
    });
    return out;
  }
  if (sort === "best_lap_desc") {
    out.sort((a, b) => {
      const la = runBestLapSeconds(a);
      const lb = runBestLapSeconds(b);
      if (la == null && lb == null) return 0;
      if (la == null) return 1;
      if (lb == null) return -1;
      return lb - la;
    });
    return out;
  }
  out.sort(
    (a, b) => resolveRunDisplayInstant(b).getTime() - resolveRunDisplayInstant(a).getTime()
  );
  return out;
}
