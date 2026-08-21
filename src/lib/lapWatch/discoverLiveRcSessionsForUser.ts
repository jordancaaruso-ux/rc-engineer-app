import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  extractPracticeSessions,
  extractRaceSessions,
  isLiveRcPracticeListUrl,
  isLiveRcResultsDiscoveryUrl,
  raceListRowMatchesAnyConfiguredClass,
} from "@/lib/lapWatch/livercSessionIndexParsers";
import {
  liveRcNameMatchesConfigured,
  normalizeLiveRcDriverNameForMatch,
} from "@/lib/lapWatch/liveRcNameNormalize";
import {
  resolveMostRecentPracticeListUrl,
  resolveRaceEventHubUrl,
} from "@/lib/lapWatch/resolveLiveRcIndexUrl";
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
    hubRows: number;
    hubRowsAfterClassFilter: number;
    resultPagesFetched: number;
    /** Pages left unfetched because the crawl wall-clock budget was hit (newest-first, so these are the oldest). */
    resultPagesSkippedForBudget: number;
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
  const match = /\((\d{4,10})\)\s*$/.exec(rowText?.trim() ?? "");
  return match ? `Transponder ${match[1]}` : null;
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
      hubRows: 0,
      hubRowsAfterClassFilter: 0,
      resultPagesFetched: 0,
      resultPagesSkippedForBudget: 0,
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
}): Promise<DiscoverLiveRcSessionsResult> {
  const origin = normalizeLiveRcTrackOrigin(input.trackLiveRcUrl);
  const emptyMeeting = { detected: false, eventHubUrl: null, eventLabel: null };

  const liveName = (await getLiveRcDriverNameSetting(input.userId).catch(() => null))?.trim() ?? "";
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
      debug,
    };
  }

  const [practiceResolved, raceResolved, activeRaceMeeting] = await Promise.all([
    resolveMostRecentPracticeListUrl(origin),
    resolveRaceEventHubUrl(origin),
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
  if (!raceResolved.ok) {
    debug.race.resolveError = raceResolved.error;
  } else {
    debug.race.hubUrl = raceResolved.indexUrl;
  }

  const discovered: DiscoveredSession[] = [];
  /**
   * Every row on the day's page, ours or not. Only ever surfaced when nothing matched: it is how a
   * driver finds themselves printed as "Jordan C" and takes the session anyway, instead of being
   * sent to Settings and back before they can log a run they finished ten minutes ago.
   */
  const sessionsToday: LapDiscoverySessionRow[] = [];

  if (practiceResolved.ok) {
    const fetched = await fetchUrlText(practiceResolved.indexUrl);
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
        if (driverNorm && !liveRcNameMatchesConfigured(r.driverName, driverNorm)) continue;
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

  if (raceResolved.ok && driverNorm) {
    const hubFetch = await fetchUrlText(raceResolved.indexUrl);
    if (!hubFetch.ok) {
      debug.race.resolveError = debug.race.resolveError ?? hubFetch.error;
    } else {
      const hubRowsRaw = extractRaceSessions(hubFetch.text, raceResolved.indexUrl);
      debug.race.hubRows = hubRowsRaw.length;
      let raceRows = hubRowsRaw.slice(0, RACE_HUB_ROW_CAP);
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

      await mapPool(urlsToCheck, RACE_FETCH_CONCURRENCY, async (sessionUrl) => {
        if (Date.now() - crawlStart > RACE_CRAWL_BUDGET_MS) {
          pagesSkippedForBudget++;
          pageRowsByUrl.set(sessionUrl, []);
          return;
        }
        const fetchStart = Date.now();
        const fetched = await fetchUrlText(sessionUrl, { timeoutMs: RACE_FETCH_TIMEOUT_MS });
        const fetchMs = Date.now() - fetchStart;
        if (fetchMs > slowestFetchMs) slowestFetchMs = fetchMs;
        pagesFetched++;
        pageRowsByUrl.set(sessionUrl, fetched.ok ? parseLiveRcRaceResultTableRows(fetched.text) : []);
      });

      const crawlMs = Date.now() - crawlStart;
      debug.race.resultPagesFetched = pagesFetched;
      debug.race.resultPagesSkippedForBudget = pagesSkippedForBudget;
      debug.race.crawlMs = crawlMs;
      if (pagesSkippedForBudget > 0) {
        console.warn(
          "[liverc-discovery] race crawl budget exhausted",
          JSON.stringify({
            userId: input.userId,
            hubUrl: raceResolved.indexUrl,
            pagesFetched,
            pagesSkippedForBudget,
            crawlMs,
            slowestFetchMs,
            budgetMs: RACE_CRAWL_BUDGET_MS,
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
    raceHubUrl: raceResolved.ok ? raceResolved.indexUrl : null,
    hint: status ? lapDiscoveryStatusMessage(status) : null,
    status,
    activeRaceMeeting,
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
