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
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";
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

const RACE_HUB_ROW_CAP = 40;
const RACE_FETCH_CONCURRENCY = 5;

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
  activeRaceMeeting: {
    detected: boolean;
    eventHubUrl: string | null;
    eventLabel: string | null;
  };
  debug: LiveRcTrackDiscoveryDebug;
};

function practiceRowMatchesDriverRelaxed(normRow: string, driverNorm: string): boolean {
  const tokens = driverNorm.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 2) return false;
  return tokens.every((t) => normRow.includes(t));
}

function practiceRowMatchesDriver(normRow: string, driverNorm: string): boolean {
  if (!driverNorm || !normRow) return false;
  if (normRow === driverNorm) return true;
  return practiceRowMatchesDriverRelaxed(normRow, driverNorm);
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
      canonicalDriverId: null,
      sessionsWithDriverId: 0,
    },
    summary: { totalMatched: 0, alreadyImported: 0, unimported: 0 },
    ...partial,
  };
}

function buildHint(
  driverNorm: string,
  debug: LiveRcTrackDiscoveryDebug,
  unimportedCount: number
): string | null {
  if (!driverNorm) {
    return "Set your LiveRC driver name in Settings to find your sessions.";
  }
  if (unimportedCount > 0) return null;

  const { practice, race, summary } = debug;
  if (summary.totalMatched > 0 && summary.alreadyImported === summary.totalMatched) {
    return `All ${summary.totalMatched} matching session(s) are already imported. Use “Show import debug” below to see what LiveRC returned.`;
  }
  if (practice.resolveError && race.resolveError) {
    return `Could not resolve practice or race pages from LiveRC (${practice.resolveError}; ${race.resolveError}).`;
  }
  if (practice.rowsOnPage > 0 && practice.rowsMatchingDriver === 0) {
    return `Found ${practice.rowsOnPage} practice session(s) on LiveRC but none match your driver name. Check Settings → LiveRC driver name against: ${practice.sampleDriverNamesOnPage.slice(0, 5).join(" · ") || "—"}.`;
  }
  if (race.hubRows > 0 && race.sessionsWithDriverId === 0 && !race.canonicalDriverId) {
    return "Race sessions exist on LiveRC but your driver ID could not be resolved. Import any race once or set LiveRC driver ID in Settings.";
  }
  if (practice.rowsOnPage === 0 && race.hubRows === 0) {
    return "LiveRC returned no sessions on the resolved practice day or race hub. You may need to wait until timing is posted.";
  }
  return "No matching sessions found at this track. Use “Show import debug” below for details.";
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
        if (driverNorm) {
          const normRow = normalizeLiveRcDriverNameForMatch(r.driverName);
          if (!practiceRowMatchesDriver(normRow, driverNorm)) continue;
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
      debug.race.resultPagesFetched = urlsToCheck.length;
      const pageRowsByUrl = new Map<string, ReturnType<typeof parseLiveRcRaceResultTableRows>>();

      await mapPool(urlsToCheck, RACE_FETCH_CONCURRENCY, async (sessionUrl) => {
        const fetched = await fetchUrlText(sessionUrl);
        pageRowsByUrl.set(sessionUrl, fetched.ok ? parseLiveRcRaceResultTableRows(fetched.text) : []);
      });

      const canonicalId = await resolveCanonicalLiveRcDriverId(input.userId, pageRowsByUrl, driverNorm);
      debug.race.canonicalDriverId = canonicalId;

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

  const hint = buildHint(driverNorm, debug, unimportedCandidates.length);

  return {
    mostRecentSession: unimportedCandidates[0] ?? candidates[0] ?? null,
    candidates,
    unimportedCandidates,
    practiceIndexUrl: practiceResolved.ok ? practiceResolved.indexUrl : null,
    raceHubUrl: raceResolved.ok ? raceResolved.indexUrl : null,
    hint,
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
