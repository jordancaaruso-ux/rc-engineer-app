import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getLiveRcDriverIdSetting,
  getLiveRcDriverNameSetting,
  setLiveRcDriverIdSetting,
} from "@/lib/appSettings";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  parseLiveRcRaceResultTableRows,
  type ParsedLiveRcResultRow,
} from "@/lib/lapUrlParsers/livercRaceResult";
import {
  extractRaceSessions,
  isLiveRcResultsDiscoveryUrl,
} from "@/lib/lapWatch/livercSessionIndexParsers";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

const MAX_HUB_ROWS = 120;
const FETCH_CONCURRENCY = 5;

export type MyRaceSessionRow = {
  sessionUrl: string;
  listLinkText: string | null;
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  /** Import row exists; user can still attach laps to this run. */
  alreadyImported: boolean;
  existingImportedSessionId: string | null;
};

export type MyRaceSessionsForEventResult = {
  sessions: MyRaceSessionRow[];
  hint: string | null;
  /** Rows on hub before driver filter / exclusions. */
  hubRowCount: number;
  /** Race result pages fetched for driver matching. */
  pagesChecked: number;
};

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

/** Prefer numeric LiveRC ids from stored race imports (matches configured driver name). */
async function inferLiveRcDriverIdFromRecentImports(
  userId: string,
  driverNorm: string
): Promise<string | null> {
  const rows = await prisma.importedLapTimeSession.findMany({
    where: { userId, sourceType: "liverc" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { parsedPayload: true },
  });
  for (const row of rows) {
    const payload = row.parsedPayload;
    if (!payload || typeof payload !== "object") continue;
    const sessionDrivers = (payload as Record<string, unknown>).sessionDrivers;
    if (!Array.isArray(sessionDrivers)) continue;
    for (const raw of sessionDrivers) {
      if (!raw || typeof raw !== "object") continue;
      const d = raw as { driverName?: string; driverId?: string };
      const id = typeof d.driverId === "string" ? d.driverId.trim() : "";
      if (!id || id.startsWith("sd-")) continue;
      if (normalizeLiveRcDriverNameForMatch(d.driverName ?? "") !== driverNorm) continue;
      return id;
    }
  }
  return null;
}

function countNameMatchesByDriverId(
  pages: Map<string, ParsedLiveRcResultRow[]>,
  driverNorm: string
): Map<string, number> {
  const sessionCountByDriverId = new Map<string, number>();
  for (const [, rows] of pages) {
    const matchedIds = new Set<string>();
    for (const r of rows) {
      if (normalizeLiveRcDriverNameForMatch(r.driverName) !== driverNorm) continue;
      matchedIds.add(r.driverId);
    }
    for (const id of matchedIds) {
      sessionCountByDriverId.set(id, (sessionCountByDriverId.get(id) ?? 0) + 1);
    }
  }
  return sessionCountByDriverId;
}

function idAppearsWithName(
  pages: Map<string, ParsedLiveRcResultRow[]>,
  driverId: string,
  driverNorm: string
): boolean {
  for (const rows of pages.values()) {
    if (
      rows.some(
        (r) =>
          r.driverId === driverId && normalizeLiveRcDriverNameForMatch(r.driverName) === driverNorm
      )
    ) {
      return true;
    }
  }
  return false;
}

function pickArgmaxWinners(m: Map<string, number>): string[] {
  let bestN = -1;
  for (const v of m.values()) {
    if (v > bestN) bestN = v;
  }
  if (bestN < 0) return [];
  return [...m.entries()].filter(([, v]) => v === bestN).map(([k]) => k);
}

/**
 * Lists LiveRC race result sessions on the event's results hub where your LiveRC **driver id**
 * appears in the result table (disambiguates same full name on A/B/C mains). Resolves id from
 * stored setting, recent imports, and name→id counts across sessions.
 */
export async function listMyPendingRaceSessionsForEvent(
  userId: string,
  eventId: string
): Promise<MyRaceSessionsForEventResult> {
  const liveName = (await getLiveRcDriverNameSetting(userId).catch(() => null))?.trim() ?? "";
  const driverNorm = liveName ? normalizeLiveRcDriverNameForMatch(liveName) : "";
  if (!driverNorm) {
    return {
      sessions: [],
      hint: "Set your LiveRC driver name in Settings so we can find your driver ID in each race result.",
      hubRowCount: 0,
      pagesChecked: 0,
    };
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    select: { resultsSourceUrl: true },
  });
  const pageUrl = event?.resultsSourceUrl?.trim() ?? "";
  if (!pageUrl) {
    return {
      sessions: [],
      hint: "Add a LiveRC results URL on the event (LiveRC lap detection → Results URL).",
      hubRowCount: 0,
      pagesChecked: 0,
    };
  }

  if (!isLiveRcResultsDiscoveryUrl(pageUrl)) {
    return {
      sessions: [],
      hint: "The saved results URL must be a LiveRC /results/ page that lists race sessions.",
      hubRowCount: 0,
      pagesChecked: 0,
    };
  }

  const hubFetch = await fetchUrlText(pageUrl);
  if (!hubFetch.ok) {
    return {
      sessions: [],
      hint: `Could not load the results page: ${hubFetch.error}`,
      hubRowCount: 0,
      pagesChecked: 0,
    };
  }

  const hubRows = extractRaceSessions(hubFetch.text, pageUrl).slice(0, MAX_HUB_ROWS);
  const hubRowCount = hubRows.length;

  const metaByUrl = new Map<
    string,
    { listLinkText: string | null; sessionTime: string | null; sessionCompletedAtIso: string | null }
  >();
  const uniqueUrls: string[] = [];
  const seen = new Set<string>();
  for (const r of hubRows) {
    const u = r.sessionUrl.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    uniqueUrls.push(u);
    metaByUrl.set(u, {
      listLinkText: r.listLinkText?.trim() ? r.listLinkText.trim() : null,
      sessionTime: r.sessionTime ?? null,
      sessionCompletedAtIso: r.sessionCompletedAtIso,
    });
  }

  if (uniqueUrls.length === 0) {
    return {
      sessions: [],
      hint: "No race result links found on this results page.",
      hubRowCount: 0,
      pagesChecked: 0,
    };
  }

  const imports = await prisma.importedLapTimeSession.findMany({
    where: { userId, sourceUrl: { in: uniqueUrls } },
    select: { id: true, sourceUrl: true, linkedRunId: true },
  });
  const importByUrl = new Map<string, { id: string; linkedRunId: string | null }>();
  for (const row of imports) {
    importByUrl.set(row.sourceUrl.trim(), { id: row.id, linkedRunId: row.linkedRunId });
  }

  const needDriverCheck: string[] = [];
  const pendingWithoutLink: Array<{ url: string; importedSessionId: string }> = [];

  for (const u of uniqueUrls) {
    const imp = importByUrl.get(u);
    if (imp?.linkedRunId) continue;
    if (imp && !imp.linkedRunId) {
      pendingWithoutLink.push({ url: u, importedSessionId: imp.id });
      continue;
    }
    needDriverCheck.push(u);
  }

  const urlsToAnalyze = [...new Set([...needDriverCheck, ...pendingWithoutLink.map((p) => p.url)])];

  if (urlsToAnalyze.length === 0) {
    return {
      sessions: [],
      hint: "Every session from this results page is already linked to a saved run.",
      hubRowCount,
      pagesChecked: 0,
    };
  }

  const pageRowsByUrl = new Map<string, ParsedLiveRcResultRow[]>();

  await mapPool(urlsToAnalyze, FETCH_CONCURRENCY, async (sessionUrl) => {
    const fetched = await fetchUrlText(sessionUrl);
    const rows = fetched.ok ? parseLiveRcRaceResultTableRows(fetched.text) : [];
    pageRowsByUrl.set(sessionUrl, rows);
  });

  const pagesChecked = urlsToAnalyze.length;

  const sessionCountByDriverId = countNameMatchesByDriverId(pageRowsByUrl, driverNorm);
  const storedId = (await getLiveRcDriverIdSetting(userId).catch(() => null))?.trim() ?? "";
  const bootstrapId = (await inferLiveRcDriverIdFromRecentImports(userId, driverNorm))?.trim() ?? "";

  let canonicalId: string | null = null;

  if (storedId && idAppearsWithName(pageRowsByUrl, storedId, driverNorm)) {
    canonicalId = storedId;
  } else if (bootstrapId && sessionCountByDriverId.has(bootstrapId)) {
    canonicalId = bootstrapId;
  } else if (sessionCountByDriverId.size === 1) {
    canonicalId = [...sessionCountByDriverId.keys()][0]!;
  } else if (sessionCountByDriverId.size > 1) {
    const winners = pickArgmaxWinners(sessionCountByDriverId);
    if (winners.length === 1) {
      canonicalId = winners[0]!;
    } else if (bootstrapId && winners.includes(bootstrapId)) {
      canonicalId = bootstrapId;
    } else if (
      storedId &&
      winners.includes(storedId) &&
      idAppearsWithName(pageRowsByUrl, storedId, driverNorm)
    ) {
      canonicalId = storedId;
    } else {
      canonicalId = winners.sort()[0]!;
    }
  }

  if (
    canonicalId &&
    !storedId &&
    (sessionCountByDriverId.size === 1 ||
      (pickArgmaxWinners(sessionCountByDriverId).length === 1 &&
        pickArgmaxWinners(sessionCountByDriverId)[0] === canonicalId))
  ) {
    await setLiveRcDriverIdSetting(userId, canonicalId).catch(() => {});
  }

  const out: MyRaceSessionRow[] = [];

  function pushIfCanonical(u: string, alreadyImported: boolean, existingId: string | null) {
    if (!canonicalId) return;
    const rows = pageRowsByUrl.get(u) ?? [];
    if (!rows.some((r) => r.driverId === canonicalId)) return;
    const meta = metaByUrl.get(u)!;
    out.push({
      sessionUrl: u,
      listLinkText: meta.listLinkText,
      sessionTime: meta.sessionTime,
      sessionCompletedAtIso: meta.sessionCompletedAtIso,
      alreadyImported,
      existingImportedSessionId: existingId,
    });
  }

  for (const p of pendingWithoutLink) {
    pushIfCanonical(p.url, true, p.importedSessionId);
  }
  for (const u of needDriverCheck) {
    pushIfCanonical(u, false, null);
  }

  out.sort((a, b) => {
    const ta = a.sessionCompletedAtIso ? new Date(a.sessionCompletedAtIso).getTime() : 0;
    const tb = b.sessionCompletedAtIso ? new Date(b.sessionCompletedAtIso).getTime() : 0;
    return tb - ta;
  });

  let hint: string | null = null;
  if (!canonicalId && pagesChecked > 0) {
    hint =
      "Could not resolve your LiveRC driver ID from these sessions (import any correct race for your name first, or set Driver ID in Settings).";
  } else if (canonicalId && out.length === 0 && pagesChecked > 0) {
    hint =
      "No remaining sessions list your driver ID (or every session is already linked to a run).";
  }

  return {
    sessions: out,
    hint,
    hubRowCount,
    pagesChecked,
  };
}
