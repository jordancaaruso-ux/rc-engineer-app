import type { Prisma } from "@prisma/client";
import { getBestLap, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatLocalCalendarDate } from "@/lib/engineerPhase5/localCalendarInTimeZone";

export type RunHistorySort = "completed_desc" | "completed_asc" | "best_lap_asc" | "best_lap_desc";
export type RunHistoryLayout = "grouped" | "flat";
export type RunHistoryStatus = "all" | "draft" | "complete";

export type RunHistoryFilters = {
  q: string | null;
  carIds: string[];
  trackIds: string[];
  tireSetIds: string[];
  eventId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  sessionType: "TESTING" | "RACE_MEETING" | null;
  meetingSessionType: string | null;
  bestLapMin: number | null;
  bestLapMax: number | null;
  raceClass: string | null;
  status: RunHistoryStatus;
  sort: RunHistorySort;
  layout: RunHistoryLayout;
};

export const DEFAULT_RUN_HISTORY_FILTERS: RunHistoryFilters = {
  q: null,
  carIds: [],
  trackIds: [],
  tireSetIds: [],
  eventId: null,
  dateFrom: null,
  dateTo: null,
  sessionType: null,
  meetingSessionType: null,
  bestLapMin: null,
  bestLapMax: null,
  raceClass: null,
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
  const tireSetIds = parseIdList(firstParam(searchParams.tireSetIds));
  const eventId = firstParam(searchParams.eventId) || null;
  const dateFrom = firstParam(searchParams.dateFrom) || null;
  const dateTo = firstParam(searchParams.dateTo) || null;
  const sessionType = parseSessionType(firstParam(searchParams.sessionType));
  const meetingSessionType = firstParam(searchParams.meetingSessionType) || null;
  const bestLapMin = parseOptionalFloat(firstParam(searchParams.bestLapMin));
  const bestLapMax = parseOptionalFloat(firstParam(searchParams.bestLapMax));
  const raceClass = firstParam(searchParams.raceClass) || null;
  const status = parseStatus(firstParam(searchParams.status));
  const sort = parseSort(firstParam(searchParams.sort));
  const layout = parseLayout(firstParam(searchParams.layout));

  return {
    q,
    carIds: [...new Set(carIds)],
    trackIds: [...new Set(trackIds)],
    tireSetIds,
    eventId,
    dateFrom,
    dateTo,
    sessionType,
    meetingSessionType,
    bestLapMin,
    bestLapMax,
    raceClass,
    status,
    sort,
    layout,
  };
}

export function runHistoryFiltersActive(filters: RunHistoryFilters): boolean {
  return (
    Boolean(filters.q) ||
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
    filters.status !== "all"
  );
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
  setOrDelete("tireSetIds", filters.tireSetIds.length ? filters.tireSetIds.join(",") : null);
  setOrDelete("eventId", filters.eventId);
  setOrDelete("dateFrom", filters.dateFrom);
  setOrDelete("dateTo", filters.dateTo);
  setOrDelete("sessionType", filters.sessionType);
  setOrDelete("meetingSessionType", filters.meetingSessionType);
  setOrDelete("bestLapMin", filters.bestLapMin != null ? String(filters.bestLapMin) : null);
  setOrDelete("bestLapMax", filters.bestLapMax != null ? String(filters.bestLapMax) : null);
  setOrDelete("raceClass", filters.raceClass);
  setOrDelete("status", filters.status !== "all" ? filters.status : null);
  setOrDelete("sort", filters.sort !== "completed_desc" ? filters.sort : null);
  setOrDelete("layout", filters.layout !== "grouped" ? filters.layout : null);

  sp.delete("carId");
  sp.delete("trackId");

  return sp;
}

export function buildRunHistoryPrismaWhere(
  filters: RunHistoryFilters,
  baseWhere: Prisma.RunWhereInput
): Prisma.RunWhereInput {
  const where: Prisma.RunWhereInput = { ...baseWhere };
  if (filters.carIds.length) where.carId = { in: filters.carIds };
  if (filters.trackIds.length) where.trackId = { in: filters.trackIds };
  if (filters.tireSetIds.length) where.tireSetId = { in: filters.tireSetIds };
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
  carNameSnapshot: string | null;
  track?: { name: string } | null;
  trackNameSnapshot: string | null;
  event?: { name: string } | null;
  tireSet?: { label: string; setNumber: number | null } | null;
};

function runBestLapSeconds(run: RunForHistoryFilter): number | null {
  if (run.bestLapSeconds != null && Number.isFinite(run.bestLapSeconds)) return run.bestLapSeconds;
  return getBestLap(primaryLapRowsFromRun(run));
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

function runMatchesTextQuery(run: RunForHistoryFilter, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const tireLabel = run.tireSet
    ? `${run.tireSet.label}${run.tireSet.setNumber != null ? ` #${run.tireSet.setNumber}` : ""}`
    : "";
  const hay = [
    run.car?.name,
    run.carNameSnapshot,
    run.track?.name,
    run.trackNameSnapshot,
    run.event?.name,
    run.sessionLabel,
    run.raceClass,
    tireLabel,
    run.notes,
    run.driverNotes,
    run.handlingProblems,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

export function applyRunHistoryPostFilters<T extends RunForHistoryFilter>(
  runs: T[],
  filters: RunHistoryFilters,
  timeZone: string
): T[] {
  return runs.filter((run) => {
    if (!runInDateWindow(run, filters.dateFrom, filters.dateTo, timeZone)) return false;
    if (filters.q && !runMatchesTextQuery(run, filters.q)) return false;
    const best = runBestLapSeconds(run);
    if (filters.bestLapMin != null && (best == null || best < filters.bestLapMin)) return false;
    if (filters.bestLapMax != null && (best == null || best > filters.bestLapMax)) return false;
    return true;
  });
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
