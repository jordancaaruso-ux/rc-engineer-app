import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { getSpeedhiveTransponderNumbersForUser } from "@/lib/speedhive/speedhiveDriverSettings";
import { fetchUrlText, type FetchTextResult } from "@/lib/lapUrlParsers/fetchText";
import {
  extractPracticeSessions,
  extractRaceSessions,
  isLiveRcPracticeListUrl,
  isLiveRcResultsDiscoveryUrl,
  raceListRowMatchesAnyConfiguredClass,
} from "@/lib/lapWatch/livercSessionIndexParsers";
import {
  liveRcPracticeRowIsMine,
  liveRcPracticeRowTransponder,
  normalizeLiveRcDriverNameForMatch,
} from "@/lib/lapWatch/liveRcNameNormalize";
import {
  resolveMostRecentPracticeListUrl,
  resolveRaceEventHubUrl,
  resolveRaceEventHubsForDay,
  type ResolveLiveRcIndexResult,
} from "@/lib/lapWatch/resolveLiveRcIndexUrl";
import { buildPracticeSessionListUrl } from "@/lib/lapWatch/liveRcIndexHtmlParse";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";
import {
  parseLiveRcRaceResultTableRows,
  resolveCanonicalLiveRcDriverId,
} from "@/lib/lapWatch/liveRcDriverIdResolve";
import { detectActiveRaceMeetingAtTrack } from "@/lib/lapWatch/detectActiveRaceMeetingAtTrack";
import {
  emptyLapDiscoveryStatus,
  lapDiscoveryStatusMessage,
  type LapDiscoverySessionRow,
  type LapDiscoveryStatus,
} from "@/lib/lapWatch/lapDiscoveryStatus";

/**
 * Cap on the day list the card can offer when nothing matched. It exists to be read by a human
 * looking for their own name, not to mirror the timing site — a club day can post hundreds.
 */
const SESSIONS_TODAY_CAP = 60;

const RACE_HUB_ROW_CAP = 40;
/**
 * One day's races only (the sweep and "Import your last runs"), across every meeting that could
 * hold them. Not a budget — every race that day is opened (founder 2026-09-17: "always search for
 * every run within the date period"); only a runaway page could reach it. The crawl's wall-clock
 * budget still bounds the time, and a crawl it cuts short says so (`incomplete`).
 */
const RACE_HUB_DAY_ROW_CAP = 400;
const RACE_FETCH_CONCURRENCY = 5;
/** Per-page timeout for the membership crawl — short, so one stuck LiveRC page can't eat the budget. */
const RACE_FETCH_TIMEOUT_MS = 9_000;
/**
 * Wall-clock ceiling for the whole race-page membership crawl. Once exceeded we stop opening new
 * pages and resolve from what we have (rows are newest-first, so the most recent sessions are
 * always fetched first). Guarantees the route returns partial results instead of blowing the
 * serverless function timeout and returning nothing — the failure seen trackside under load.
 */
const RACE_CRAWL_BUDGET_MS = 35_000;

/** The meeting hubs a look reads, and whether finding them fell short. */
type RaceHubs = { hubUrls: string[]; eventListFailed: boolean; error: string | null };

export type DiscoveredSession = {
  sessionUrl: string;
  sessionId: string;
  sessionCompletedAtIso: string | null;
  /** Display metadata only — not run session type. */
  sourceKind: "practice" | "race";
  label: string;
  alreadyImported: boolean;
  linkedRunId: string | null;
};

export type LiveRcTrackDiscoveryDebug = {
  trackOrigin: string | null;
  liveRcDriverName: string | null;
  liveRcDriverNameNormalized: string | null;
  practice: {
    resolveError: string | null;
    indexUrl: string | null;
    activityDate: string | null;
    fetchError: string | null;
    rowsOnPage: number;
    rowsMatchingDriver: number;
    sampleDriverNamesOnPage: string[];
  };
  race: {
    resolveError: string | null;
    hubUrl: string | null;
    /** Every meeting hub read — one for a live look, all that could hold a named day. */
    hubUrls: string[];
    /** The track's events page could not be read, so a named day may be missing a meeting. */
    eventListFailed: boolean;
    hubsFailed: number;
    hubRows: number;
    hubRowsAfterClassFilter: number;
    resultPagesFetched: number;
    /** Pages left unfetched because the crawl wall-clock budget was hit (newest-first, so these are the oldest). */
    resultPagesSkippedForBudget: number;
    /** Race pages that did not load — unread, not races the driver was absent from. */
    resultPagesFailed: number;
    /** Total wall-clock spent on the race-page membership crawl. */
    crawlMs: number;
    canonicalDriverId: string | null;
    sessionsWithDriverId: number;
  };
  summary: {
    totalMatched: number;
    alreadyImported: number;
    unimported: number;
  };
};

export type DiscoverLiveRcSessionsResult = {
  mostRecentSession: DiscoveredSession | null;
  /** All user-matched sessions (includes already imported). */
  candidates: DiscoveredSession[];
  /** User-matched sessions not yet imported. */
  unimportedCandidates: DiscoveredSession[];
  practiceIndexUrl: string | null;
  raceHubUrl: string | null;
  hint: string | null;
  /** Same finding as `hint`, in the pieces the card lays out. Null when there is nothing to say. */
  status: LapDiscoveryStatus | null;
  activeRaceMeeting: {
    detected: boolean;
    eventHubUrl: string | null;
    eventLabel: string | null;
  };
  /**
   * Something that should have been read was not — the practice list, the events page, a meeting
   * hub, or race pages the crawl could not open or ran out of time for. The sessions found are
   * real; the list may be short.
   */
  incomplete: boolean;
  debug: LiveRcTrackDiscoveryDebug;
};

/**
 * The transponder number LiveRC prints against a practice row, when it prints one.
 *
 * The matcher's row text runs name, class and transponder together — "Cooper DavisModified
 * (4344915)" — so the number is recovered from the trailing bracket rather than shown as-is. It is
 * worth recovering: a driver whose name doesn't match is often looking straight at their own chip
 * number, which is the other half of what the card asks them to check.
 */
function transponderFromPracticeRowText(rowText: string | null | undefined): string | null {
  const chip = liveRcPracticeRowTransponder(rowText);
  return chip != null ? `Transponder ${chip}` : null;
}

/** Newest first, and rows with no time last — the same order the picker draws matched sessions in. */
function sortSessionsTodayNewestFirst(rows: LapDiscoverySessionRow[]): LapDiscoverySessionRow[] {
  return [...rows].sort(
    (a, b) => sessionSortKey(b.sessionCompletedAtIso) - sessionSortKey(a.sessionCompletedAtIso)
  );
}

function sessionSortKey(iso: string | null): number {
  if (!iso?.trim()) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) break;
      await fn(items[i]!);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

function emptyDebug(partial?: Partial<LiveRcTrackDiscoveryDebug>): LiveRcTrackDiscoveryDebug {
  return {
    trackOrigin: null,
    liveRcDriverName: null,
    liveRcDriverNameNormalized: null,
    practice: {
      resolveError: null,
      indexUrl: null,
      activityDate: null,
      fetchError: null,
      rowsOnPage: 0,
      rowsMatchingDriver: 0,
      sampleDriverNamesOnPage: [],
    },
    race: {
      resolveError: null,
      hubUrl: null,
      hubUrls: [],
      eventListFailed: false,
      hubsFailed: 0,
      hubRows: 0,
      hubRowsAfterClassFilter: 0,
      resultPagesFetched: 0,
      resultPagesSkippedForBudget: 0,
      resultPagesFailed: 0,
      crawlMs: 0,
      canonicalDriverId: null,
      sessionsWithDriverId: 0,
    },
    summary: { totalMatched: 0, alreadyImported: 0, unimported: 0 },
    ...partial,
  };
}

/**
 * Read the scan's own debug counters back as a state the card can act on.
 *
 * Order matters and is not the order the old sentence used. "Nothing is posted" is checked before
 * "nothing matched", because a driver told to go and fix their name at a track that has uploaded
 * nothing goes and fixes something that was never broken.
 */
function buildStatus(opts: {
  driverNorm: string;
  debug: LiveRcTrackDiscoveryDebug;
  unimportedCount: number;
  sessionsToday: LapDiscoverySessionRow[];
}): LapDiscoveryStatus | null {
  const { driverNorm, debug, unimportedCount, sessionsToday } = opts;
  const { practice, race, summary } = debug;

  const resolvedPages = [practice.indexUrl, race.hubUrl].filter((u): u is string =>
    Boolean(u?.trim())
  );
  // Falling back to the club's front page matters most in the state where there are no resolved
  // pages at all: when we couldn't reach the site, "open it yourself and see" is the entire answer,
  // and that is exactly when the practice index and race hub are both null.
  const timingPages = (resolvedPages.length > 0
    ? resolvedPages
    : [debug.trackOrigin].filter((u): u is string => Boolean(u?.trim()))
  ).map((url) => ({ source: "liverc" as const, url }));

  const base = (code: LapDiscoveryStatus["code"]): LapDiscoveryStatus => ({
    code,
    sources: ["liverc"],
    postedCount: practice.rowsOnPage + race.hubRows,
    matchedCount: summary.totalMatched,
    timingPages,
    // Only carried where it can be used: the day list is the escape hatch from a name that
    // doesn't match, so it is noise on any other state.
    sessionsToday: code === "no_match" ? sessionsToday : [],
    postedDayIso: practice.activityDate,
  });

  if (!driverNorm) return base("no_identity");
  // Something is importable — the card lists it, and a state written over a list is just noise.
  if (unimportedCount > 0) return null;

  if (summary.totalMatched > 0 && summary.alreadyImported === summary.totalMatched) {
    return base("all_imported");
  }
  if (practice.fetchError || (practice.resolveError && race.resolveError)) {
    return base("unreachable");
  }
  if (practice.rowsOnPage === 0 && race.hubRows === 0) {
    return base("nothing_posted");
  }
  return base("no_match");
}

export async function discoverLiveRcSessionsForUser(input: {
  userId: string;
  trackLiveRcUrl: string;
  onlyNewSince?: Date | null;
  eventRaceClass?: string | null;
  referenceDate?: Date;
  /**
   * "Get my day": read this practice day's list (YYYY-MM-DD, the track's own date) instead of the
   * newest one the track posted.
   */
  practiceDayYmd?: string | null;
  /** Wall-clock ceiling for the race-page crawl; defaults to the live look's 35 s. */
  raceCrawlBudgetMs?: number;
  /**
   * Pages already fetched, by URL. The timing sweep looks for every listening driver at a track
   * in one go and the pages are the same for all of them, so it shares one cache across the
   * drivers; the second crawl of a hub is then all memory and no network.
   */
  pageCache?: Map<string, FetchTextResult> | null;
}): Promise<DiscoverLiveRcSessionsResult> {
  const origin = normalizeLiveRcTrackOrigin(input.trackLiveRcUrl);
  const cache = input.pageCache ?? null;
  const fetchPage = async (url: string, options?: { timeoutMs?: number }): Promise<FetchTextResult> => {
    const hit = cache?.get(url);
    if (hit) return hit;
    const fetched = await fetchUrlText(url, options);
    if (cache && fetched.ok) cache.set(url, fetched);
    return fetched;
  };
  const emptyMeeting = { detected: false, eventHubUrl: null, eventLabel: null };

  const [liveNameRaw, transponders] = await Promise.all([
    getLiveRcDriverNameSetting(input.userId).catch(() => null),
    // The driver's own chips — the same list MYLAPS is matched on. LiveRC prints the chip on a
    // practice row, so a saved chip finds the run whatever the club typed as the name.
    getSpeedhiveTransponderNumbersForUser(input.userId).catch(() => [] as number[]),
  ]);
  const liveName = liveNameRaw?.trim() ?? "";
  const driverNorm = liveName ? normalizeLiveRcDriverNameForMatch(liveName) : "";

  const debug = emptyDebug({
    trackOrigin: origin,
    liveRcDriverName: liveName || null,
    liveRcDriverNameNormalized: driverNorm || null,
  });

  if (!origin) {
    return {
      mostRecentSession: null,
      candidates: [],
      unimportedCandidates: [],
      practiceIndexUrl: null,
      raceHubUrl: null,
      hint: "Invalid LiveRC track URL.",
      status: emptyLapDiscoveryStatus("invalid_url", "liverc"),
      activeRaceMeeting: emptyMeeting,
      incomplete: true,
      debug,
    };
  }

  const practiceDay = input.practiceDayYmd?.trim() || null;
  const crawlBudgetMs = input.raceCrawlBudgetMs ?? RACE_CRAWL_BUDGET_MS;
  const [practiceResolved, raceHubs, activeRaceMeeting] = await Promise.all([
    practiceDay
      ? Promise.resolve<ResolveLiveRcIndexResult>({
          ok: true,
          indexUrl: buildPracticeSessionListUrl(origin, practiceDay),
          kind: "practice",
          activityDate: practiceDay,
        })
      : resolveMostRecentPracticeListUrl(origin),
    // A named day reads every meeting that could hold it; otherwise the current meeting only.
    practiceDay
      ? resolveRaceEventHubsForDay(origin, practiceDay).then((r): RaceHubs => ({ ...r, error: null }))
      : resolveRaceEventHubUrl(origin).then(
          (r): RaceHubs =>
            r.ok
              ? { hubUrls: [r.indexUrl], eventListFailed: false, error: null }
              : { hubUrls: [], eventListFailed: false, error: r.error },
        ),
    detectActiveRaceMeetingAtTrack({
      trackLiveRcUrl: origin,
      referenceDate: input.referenceDate,
    }),
  ]);

  if (!practiceResolved.ok) {
    debug.practice.resolveError = practiceResolved.error;
  } else {
    debug.practice.indexUrl = practiceResolved.indexUrl;
    debug.practice.activityDate = practiceResolved.activityDate;
  }
  debug.race.hubUrls = raceHubs.hubUrls;
  debug.race.hubUrl = raceHubs.hubUrls[0] ?? null;
  debug.race.eventListFailed = raceHubs.eventListFailed;
  if (raceHubs.hubUrls.length === 0) {
    debug.race.resolveError =
      raceHubs.error ?? (raceHubs.eventListFailed ? "LiveRC events page could not be read." : null);
  }

  const discovered: DiscoveredSession[] = [];
  /**
   * Every row on the day's page, ours or not. Only ever surfaced when nothing matched: it is how a
   * driver finds themselves printed as "Jordan C" and takes the session anyway, instead of being
   * sent to Settings and back before they can log a run they finished ten minutes ago.
   */
  const sessionsToday: LapDiscoverySessionRow[] = [];

  if (practiceResolved.ok) {
    const fetched = await fetchPage(practiceResolved.indexUrl);
    if (!fetched.ok) {
      debug.practice.fetchError = fetched.error;
    } else {
      const rows = extractPracticeSessions(fetched.text, practiceResolved.indexUrl);
      debug.practice.rowsOnPage = rows.length;
      debug.practice.sampleDriverNamesOnPage = [
        ...new Set(rows.map((r) => r.driverName.trim()).filter(Boolean)),
      ].slice(0, 12);

      let practiceMatched = 0;
      for (const r of rows) {
        if (sessionsToday.length < SESSIONS_TODAY_CAP) {
          sessionsToday.push({
            sessionId: r.sessionId,
            sessionUrl: r.sessionUrl,
            label: r.listLinkText?.trim() || "Practice session",
            detail: transponderFromPracticeRowText(r.driverName),
            sessionCompletedAtIso: r.sessionCompletedAtIso,
            source: "liverc",
          });
        }
        if (
          (driverNorm || transponders.length > 0) &&
          !liveRcPracticeRowIsMine(r.driverName, driverNorm, transponders)
        ) {
          continue;
        }
        practiceMatched++;
        discovered.push({
          sessionUrl: r.sessionUrl,
          sessionId: r.sessionId,
          sessionCompletedAtIso: r.sessionCompletedAtIso,
          sourceKind: "practice",
          label: r.listLinkText?.trim() || r.driverName?.trim() || "Practice session",
          alreadyImported: false,
          linkedRunId: null,
        });
      }
      debug.practice.rowsMatchingDriver = practiceMatched;
    }
  }

  if (raceHubs.hubUrls.length > 0 && driverNorm) {
    const hubFetches = await Promise.all(
      raceHubs.hubUrls.map(async (hubUrl) => ({ hubUrl, fetched: await fetchPage(hubUrl) })),
    );
    const hubRowsRaw: ReturnType<typeof extractRaceSessions> = [];
    const seenRaceUrls = new Set<string>();
    for (const { hubUrl, fetched } of hubFetches) {
      if (!fetched.ok) {
        debug.race.hubsFailed++;
        debug.race.resolveError = debug.race.resolveError ?? fetched.error;
        continue;
      }
      for (const row of extractRaceSessions(fetched.text, hubUrl)) {
        const key = row.sessionUrl.trim();
        if (seenRaceUrls.has(key)) continue;
        seenRaceUrls.add(key);
        hubRowsRaw.push(row);
      }
    }
    if (debug.race.hubsFailed < hubFetches.length) {
      debug.race.hubRows = hubRowsRaw.length;
      // A day asked for by name narrows the hubs to that day's races BEFORE the cap. A meeting hub
      // lists every round, newest first; at a state titles eight races a round, five qualifiers
      // filled all 40 slots and the practice and seeding rounds were never opened. LiveRC times
      // are the track's wall clock stored as UTC, so the ISO date is the track's date.
      const dayRows = practiceDay
        ? hubRowsRaw.filter((r) => r.sessionCompletedAtIso?.slice(0, 10) === practiceDay)
        : hubRowsRaw;
      let raceRows = dayRows.slice(0, practiceDay ? RACE_HUB_DAY_ROW_CAP : RACE_HUB_ROW_CAP);
      const rc = input.eventRaceClass?.trim();
      if (rc) {
        const narrowed = raceRows.filter((r) => raceListRowMatchesAnyConfiguredClass(r, rc));
        if (narrowed.length > 0) raceRows = narrowed;
      }
      debug.race.hubRowsAfterClassFilter = raceRows.length;

      const withTime = [...raceRows].sort(
        (a, b) => sessionSortKey(b.sessionCompletedAtIso) - sessionSortKey(a.sessionCompletedAtIso)
      );

      const urlsToCheck = withTime.map((r) => r.sessionUrl.trim()).filter(Boolean);
      const pageRowsByUrl = new Map<string, ReturnType<typeof parseLiveRcRaceResultTableRows>>();

      // Membership crawl: open each race page (newest-first) to see which contain the driver. LiveRC's
      // hub doesn't list drivers, so this is unavoidable — but it's bounded by a wall-clock budget and a
      // short per-page timeout so a slow LiveRC (live-event load) can't stall the whole route.
      const crawlStart = Date.now();
      let pagesFetched = 0;
      let pagesSkippedForBudget = 0;
      let slowestFetchMs = 0;

      let pagesFailed = 0;
      await mapPool(urlsToCheck, RACE_FETCH_CONCURRENCY, async (sessionUrl) => {
        if (Date.now() - crawlStart > crawlBudgetMs) {
          pagesSkippedForBudget++;
          pageRowsByUrl.set(sessionUrl, []);
          return;
        }
        const fetchStart = Date.now();
        const fetched = await fetchPage(sessionUrl, { timeoutMs: RACE_FETCH_TIMEOUT_MS });
        const fetchMs = Date.now() - fetchStart;
        if (fetchMs > slowestFetchMs) slowestFetchMs = fetchMs;
        pagesFetched++;
        // A page that did not load is not a race the driver was absent from — it is unread.
        if (!fetched.ok) pagesFailed++;
        pageRowsByUrl.set(sessionUrl, fetched.ok ? parseLiveRcRaceResultTableRows(fetched.text) : []);
      });

      const crawlMs = Date.now() - crawlStart;
      debug.race.resultPagesFetched = pagesFetched;
      debug.race.resultPagesSkippedForBudget = pagesSkippedForBudget;
      debug.race.resultPagesFailed = pagesFailed;
      debug.race.crawlMs = crawlMs;
      if (pagesSkippedForBudget > 0) {
        console.warn(
          "[liverc-discovery] race crawl budget exhausted",
          JSON.stringify({
            userId: input.userId,
            hubUrls: raceHubs.hubUrls,
            pagesFetched,
            pagesSkippedForBudget,
            crawlMs,
            slowestFetchMs,
            budgetMs: crawlBudgetMs,
          })
        );
      }

      const canonicalId = await resolveCanonicalLiveRcDriverId(input.userId, pageRowsByUrl, driverNorm);
      debug.race.canonicalDriverId = canonicalId;

      // Race rows join the day list as sessions, not as drivers: the hub prints no names, and the
      // per-race entrant lists would run to hundreds. A driver who can't be matched picks the race
      // they were in and chooses themselves from the session's own driver picker after import.
      for (const r of withTime) {
        if (sessionsToday.length >= SESSIONS_TODAY_CAP) break;
        sessionsToday.push({
          sessionId: r.sessionId,
          sessionUrl: r.sessionUrl,
          label: r.listLinkText?.trim() || r.raceClass?.trim() || "Race session",
          detail: null,
          sessionCompletedAtIso: r.sessionCompletedAtIso,
          source: "liverc",
        });
      }

      let raceMatched = 0;
      if (canonicalId) {
        for (const r of withTime) {
          const rows = pageRowsByUrl.get(r.sessionUrl.trim()) ?? [];
          if (!rows.some((row) => row.driverId === canonicalId)) continue;
          raceMatched++;
          discovered.push({
            sessionUrl: r.sessionUrl,
            sessionId: r.sessionId,
            sessionCompletedAtIso: r.sessionCompletedAtIso,
            sourceKind: "race",
            label: r.listLinkText?.trim() || r.raceClass?.trim() || "Race session",
            alreadyImported: false,
            linkedRunId: null,
          });
        }
      }
      debug.race.sessionsWithDriverId = raceMatched;
    }
  }

  const urls = discovered.map((d) => d.sessionUrl);
  const imports =
    urls.length > 0
      ? await prisma.importedLapTimeSession.findMany({
          where: { userId: input.userId, sourceUrl: { in: urls } },
          select: { sourceUrl: true, linkedRunId: true },
        })
      : [];
  const importMap = new Map(imports.map((i) => [i.sourceUrl.trim(), i.linkedRunId]));

  let candidates = discovered.map((d) => {
    const linkedRunId = importMap.get(d.sessionUrl.trim()) ?? null;
    return {
      ...d,
      alreadyImported: importMap.has(d.sessionUrl.trim()),
      linkedRunId,
    };
  });

  if (input.onlyNewSince) {
    const since = input.onlyNewSince.getTime();
    candidates = candidates.filter((c) => {
      const t = sessionSortKey(c.sessionCompletedAtIso);
      return t > since;
    });
  }

  candidates.sort((a, b) => {
    const ta = sessionSortKey(a.sessionCompletedAtIso);
    const tb = sessionSortKey(b.sessionCompletedAtIso);
    if (tb !== ta) return tb - ta;
    return a.sessionUrl.localeCompare(b.sessionUrl);
  });

  const unimportedCandidates = candidates.filter((c) => !c.alreadyImported);
  debug.summary = {
    totalMatched: candidates.length,
    alreadyImported: candidates.filter((c) => c.alreadyImported).length,
    unimported: unimportedCandidates.length,
  };

  const status = buildStatus({
    driverNorm,
    debug,
    unimportedCount: unimportedCandidates.length,
    sessionsToday: sortSessionsTodayNewestFirst(sessionsToday),
  });

  return {
    mostRecentSession: unimportedCandidates[0] ?? candidates[0] ?? null,
    candidates,
    unimportedCandidates,
    practiceIndexUrl: practiceResolved.ok ? practiceResolved.indexUrl : null,
    raceHubUrl: raceHubs.hubUrls[0] ?? null,
    hint: status ? lapDiscoveryStatusMessage(status) : null,
    status,
    activeRaceMeeting,
    incomplete:
      Boolean(practiceResolved.ok && debug.practice.fetchError) ||
      (Boolean(driverNorm) &&
        (raceHubs.eventListFailed ||
          raceHubs.hubUrls.length === 0 ||
          debug.race.hubsFailed > 0 ||
          debug.race.resultPagesFailed > 0 ||
          debug.race.resultPagesSkippedForBudget > 0)),
    debug,
  };
}

/** Resolve explicit index URL or track origin for discovery entry points. */
export async function resolveTrackOrIndexForDiscovery(
  urlOrOrigin: string,
  kind: "practice" | "results"
): Promise<string | null> {
  const trimmed = urlOrOrigin.trim();
  if (kind === "practice" && isLiveRcPracticeListUrl(trimmed)) return trimmed;
  if (kind === "results" && isLiveRcResultsDiscoveryUrl(trimmed)) return trimmed;
  const origin = normalizeLiveRcTrackOrigin(trimmed);
  if (!origin) return null;
  const resolved =
    kind === "practice"
      ? await resolveMostRecentPracticeListUrl(origin)
      : await resolveRaceEventHubUrl(origin);
  return resolved.ok ? resolved.indexUrl : null;
}
