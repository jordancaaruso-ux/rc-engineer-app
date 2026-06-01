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

export type DiscoverLiveRcSessionsResult = {
  mostRecentSession: DiscoveredSession | null;
  candidates: DiscoveredSession[];
  practiceIndexUrl: string | null;
  raceHubUrl: string | null;
  hint: string | null;
  activeRaceMeeting: {
    detected: boolean;
    eventHubUrl: string | null;
    eventLabel: string | null;
  };
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

export async function discoverLiveRcSessionsForUser(input: {
  userId: string;
  trackLiveRcUrl: string;
  onlyNewSince?: Date | null;
  eventRaceClass?: string | null;
  referenceDate?: Date;
}): Promise<DiscoverLiveRcSessionsResult> {
  const origin = normalizeLiveRcTrackOrigin(input.trackLiveRcUrl);
  const emptyMeeting = { detected: false, eventHubUrl: null, eventLabel: null };

  if (!origin) {
    return {
      mostRecentSession: null,
      candidates: [],
      practiceIndexUrl: null,
      raceHubUrl: null,
      hint: "Invalid LiveRC track URL.",
      activeRaceMeeting: emptyMeeting,
    };
  }

  const liveName = (await getLiveRcDriverNameSetting(input.userId).catch(() => null))?.trim() ?? "";
  const driverNorm = liveName ? normalizeLiveRcDriverNameForMatch(liveName) : "";

  const [practiceResolved, raceResolved, activeRaceMeeting] = await Promise.all([
    resolveMostRecentPracticeListUrl(origin),
    resolveRaceEventHubUrl(origin),
    detectActiveRaceMeetingAtTrack({
      trackLiveRcUrl: origin,
      referenceDate: input.referenceDate,
    }),
  ]);

  const discovered: DiscoveredSession[] = [];

  if (practiceResolved.ok) {
    const fetched = await fetchUrlText(practiceResolved.indexUrl);
    if (fetched.ok) {
      const rows = extractPracticeSessions(fetched.text, practiceResolved.indexUrl);
      for (const r of rows) {
        if (driverNorm) {
          const normRow = normalizeLiveRcDriverNameForMatch(r.driverName);
          if (!practiceRowMatchesDriver(normRow, driverNorm)) continue;
        }
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
    }
  }

  if (raceResolved.ok && driverNorm) {
    const hubFetch = await fetchUrlText(raceResolved.indexUrl);
    if (hubFetch.ok) {
      let raceRows = extractRaceSessions(hubFetch.text, raceResolved.indexUrl).slice(0, RACE_HUB_ROW_CAP);
      const rc = input.eventRaceClass?.trim();
      if (rc) {
        const narrowed = raceRows.filter((r) => raceListRowMatchesAnyConfiguredClass(r, rc));
        if (narrowed.length > 0) raceRows = narrowed;
      }

      const withTime = [...raceRows].sort(
        (a, b) => sessionSortKey(b.sessionCompletedAtIso) - sessionSortKey(a.sessionCompletedAtIso)
      );

      const urlsToCheck = withTime.map((r) => r.sessionUrl.trim()).filter(Boolean);
      const pageRowsByUrl = new Map<string, ReturnType<typeof parseLiveRcRaceResultTableRows>>();

      await mapPool(urlsToCheck, RACE_FETCH_CONCURRENCY, async (sessionUrl) => {
        const fetched = await fetchUrlText(sessionUrl);
        pageRowsByUrl.set(sessionUrl, fetched.ok ? parseLiveRcRaceResultTableRows(fetched.text) : []);
      });

      const canonicalId = await resolveCanonicalLiveRcDriverId(input.userId, pageRowsByUrl, driverNorm);

      if (canonicalId) {
        for (const r of withTime) {
          const rows = pageRowsByUrl.get(r.sessionUrl.trim()) ?? [];
          if (!rows.some((row) => row.driverId === canonicalId)) continue;
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

  let hint: string | null = null;
  if (!driverNorm) {
    hint = "Set your LiveRC driver name in Settings to find your sessions.";
  } else if (candidates.length === 0) {
    hint = "No matching sessions found at this track. Try again after your next run on LiveRC.";
  }

  return {
    mostRecentSession: candidates[0] ?? null,
    candidates,
    practiceIndexUrl: practiceResolved.ok ? practiceResolved.indexUrl : null,
    raceHubUrl: raceResolved.ok ? raceResolved.indexUrl : null,
    hint,
    activeRaceMeeting,
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
