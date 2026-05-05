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
  describeEventLapDetectionScopeForEvent,
  getEventLapDetectionScope,
} from "@/lib/eventLapDetection/syncEventLapSources";

const RACE_DEBUG_ROW_CAP = 50;
const PRACTICE_DEBUG_ROW_CAP = 30;

export type EventLapDetectionDebugPayload = {
  eventId: string;
  eventName: string;
  eventStartDateIso: string;
  eventEndDateIso: string;
  liveRcDriverName: string | null;
  eventInSyncScope: boolean;
  scopeReason: string;
  scopeStrategy: "active_today" | "fallback_most_recent";
  scopedEventIds: string[];
  importedSessionCounts: { practice: number; race: number; total: number };
  practice: null | {
    url: string;
    urlRecognized: boolean;
    fetchOk: boolean;
    fetchError: string | null;
    extractedRowCount: number;
    practiceLastSeenSessionCompletedAtIso: string | null;
    rowsPassingWatermark: number;
    sampleRows: Array<{
      sessionId: string;
      sessionUrl: string;
      driverName: string;
      sessionCompletedAtIso: string | null;
      passesWatermark: boolean;
    }>;
    sampleRowsTruncated: boolean;
  };
  race: null | {
    url: string;
    raceClassConfigured: string;
    urlRecognized: boolean;
    fetchOk: boolean;
    fetchError: string | null;
    eventClassNormalized: string | null;
    resultsLastSeenSessionCompletedAtIso: string | null;
    extractedRowCount: number;
    classMatchedRowCount: number;
    afterWatermarkRowCount: number;
    rows: Array<{
      sessionId: string;
      sessionUrl: string;
      raceClass: string | null;
      raceClassNormalized: string | null;
      classMatchesEvent: boolean;
      sessionTime: string | null;
      sessionCompletedAtIso: string | null;
      passesWatermark: boolean;
    }>;
    rowsTruncated: boolean;
  };
};

export async function buildEventLapDetectionDebug(
  userId: string,
  eventId: string
): Promise<EventLapDetectionDebugPayload | null> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      practiceSourceUrl: true,
      resultsSourceUrl: true,
      raceClass: true,
      practiceLastSeenSessionCompletedAt: true,
      resultsLastSeenSessionCompletedAt: true,
    },
  });
  if (!event) return null;

  const scope = await getEventLapDetectionScope(userId);
  const { eventInSyncScope, scopeReason } = describeEventLapDetectionScopeForEvent(event.id, scope);

  const liveRcDriverName = (await getLiveRcDriverNameSetting(userId).catch(() => null))?.trim() ?? null;

  const [practiceCount, raceCount, totalLinked] = await Promise.all([
    prisma.importedLapTimeSession.count({
      where: { userId, linkedEventId: event.id, eventDetectionSource: "practice" },
    }),
    prisma.importedLapTimeSession.count({
      where: { userId, linkedEventId: event.id, eventDetectionSource: "race" },
    }),
    prisma.importedLapTimeSession.count({
      where: { userId, linkedEventId: event.id },
    }),
  ]);

  const practiceUrl = event.practiceSourceUrl?.trim() ?? "";
  let practice: EventLapDetectionDebugPayload["practice"] = null;
  if (practiceUrl) {
    const urlRecognized = isLiveRcPracticeListUrl(practiceUrl);
    let fetchOk = false;
    let fetchError: string | null = urlRecognized
      ? null
      : "URL is not recognized as a LiveRC practice session list (expect …/practice/?p=session_list…).";
    let extractedRowCount = 0;
    let rowsPassingWatermark = 0;
    const sampleRows: NonNullable<EventLapDetectionDebugPayload["practice"]>["sampleRows"] = [];
    let sampleRowsTruncated = false;
    const lastSeenPractice = event.practiceLastSeenSessionCompletedAt;

    if (urlRecognized) {
      const fetched = await fetchUrlText(practiceUrl);
      fetchOk = fetched.ok;
      if (!fetched.ok) {
        fetchError = fetched.error;
      } else {
        const raw = extractPracticeSessions(fetched.text, practiceUrl);
        extractedRowCount = raw.length;
        const withTime = raw.map((x) => {
          const iso = x.sessionCompletedAtIso?.trim() ? x.sessionCompletedAtIso.trim() : null;
          const dt = iso ? new Date(iso) : null;
          const ok = dt != null && !Number.isNaN(dt.getTime());
          const passesWatermark =
            ok && (lastSeenPractice == null || dt!.getTime() > lastSeenPractice.getTime());
          return { ...x, when: ok ? dt! : null, whenOk: ok, passesWatermark };
        });
        rowsPassingWatermark = withTime.filter((d) => d.whenOk && d.passesWatermark).length;
        const sorted = [...withTime].sort((a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0));
        sampleRowsTruncated = sorted.length > PRACTICE_DEBUG_ROW_CAP;
        for (const r of sorted.slice(0, PRACTICE_DEBUG_ROW_CAP)) {
          sampleRows.push({
            sessionId: r.sessionId,
            sessionUrl: r.sessionUrl,
            driverName: r.driverName,
            sessionCompletedAtIso: r.sessionCompletedAtIso,
            passesWatermark: r.passesWatermark,
          });
        }
      }
    }

    practice = {
      url: practiceUrl,
      urlRecognized,
      fetchOk,
      fetchError,
      extractedRowCount,
      practiceLastSeenSessionCompletedAtIso: lastSeenPractice ? lastSeenPractice.toISOString() : null,
      rowsPassingWatermark,
      sampleRows,
      sampleRowsTruncated,
    };
  }

  const resultsUrl = event.resultsSourceUrl?.trim() ?? "";
  const raceClassConfigured = event.raceClass?.trim() ?? "";
  let race: EventLapDetectionDebugPayload["race"] = null;
  if (resultsUrl) {
    const urlRecognized = isLiveRcResultsDiscoveryUrl(resultsUrl);
    let fetchOk = false;
    let fetchError: string | null = urlRecognized
      ? null
      : "URL is not recognized as a LiveRC results page (expect path ending in /results).";
    let extractedRowCount = 0;
    let classMatchedRowCount = 0;
    let afterWatermarkRowCount = 0;
    const rows: NonNullable<EventLapDetectionDebugPayload["race"]>["rows"] = [];
    let rowsTruncated = false;

    const classNormDisplay = raceClassConfigured
      ? raceClassConfigured
          .split(/[,;]/)
          .map((p) => normalizeLiveRcDriverNameForMatch(p.trim()))
          .filter(Boolean)
          .join(", ")
      : null;
    const lastSeenResults = event.resultsLastSeenSessionCompletedAt;

    if (urlRecognized) {
      const fetched = await fetchUrlText(resultsUrl);
      fetchOk = fetched.ok;
      if (!fetched.ok) {
        fetchError = fetched.error;
      } else {
        const raw = extractRaceSessions(fetched.text, resultsUrl);
        extractedRowCount = raw.length;

        const decorated = raw.map((r) => {
          const rowNorm = r.raceClass ? normalizeLiveRcDriverNameForMatch(r.raceClass) : null;
          const classMatchesEvent = raceClassConfigured
            ? raceListRowMatchesAnyConfiguredClass(r, raceClassConfigured)
            : false;
          const iso = r.sessionCompletedAtIso?.trim() ? r.sessionCompletedAtIso.trim() : null;
          const dt = iso ? new Date(iso) : null;
          const whenOk = dt != null && !Number.isNaN(dt.getTime());
          const passesWatermark =
            classMatchesEvent &&
            whenOk &&
            (lastSeenResults == null || dt!.getTime() > lastSeenResults.getTime());
          return {
            sessionId: r.sessionId,
            sessionUrl: r.sessionUrl,
            raceClass: r.raceClass,
            raceClassNormalized: rowNorm,
            classMatchesEvent,
            sessionTime: r.sessionTime,
            sessionCompletedAtIso: r.sessionCompletedAtIso,
            passesWatermark,
            whenOk,
            when: whenOk ? dt! : null,
          };
        });

        classMatchedRowCount = decorated.filter((d) => d.classMatchesEvent).length;
        afterWatermarkRowCount = decorated.filter((d) => d.passesWatermark).length;

        const sorted = [...decorated].sort((a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0));
        rowsTruncated = sorted.length > RACE_DEBUG_ROW_CAP;
        for (const r of sorted.slice(0, RACE_DEBUG_ROW_CAP)) {
          rows.push({
            sessionId: r.sessionId,
            sessionUrl: r.sessionUrl,
            raceClass: r.raceClass,
            raceClassNormalized: r.raceClassNormalized,
            classMatchesEvent: r.classMatchesEvent,
            sessionTime: r.sessionTime,
            sessionCompletedAtIso: r.sessionCompletedAtIso,
            passesWatermark: r.passesWatermark,
          });
        }
      }
    }

    race = {
      url: resultsUrl,
      raceClassConfigured,
      urlRecognized,
      fetchOk,
      fetchError,
      eventClassNormalized: classNormDisplay,
      resultsLastSeenSessionCompletedAtIso: lastSeenResults ? lastSeenResults.toISOString() : null,
      extractedRowCount,
      classMatchedRowCount,
      afterWatermarkRowCount,
      rows,
      rowsTruncated,
    };
  }

  return {
    eventId: event.id,
    eventName: event.name,
    eventStartDateIso: event.startDate.toISOString(),
    eventEndDateIso: event.endDate.toISOString(),
    liveRcDriverName,
    eventInSyncScope,
    scopeReason,
    scopeStrategy: scope.strategy,
    scopedEventIds: scope.scopedEventIds,
    importedSessionCounts: {
      practice: practiceCount,
      race: raceCount,
      total: totalLinked,
    },
    practice,
    race,
  };
}
