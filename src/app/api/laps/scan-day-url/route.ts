import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  extractPracticeSessions,
  extractRaceSessions,
  isLiveRcPracticeListUrl,
  isLiveRcResultsDiscoveryUrl,
  raceListRowMatchesAnyConfiguredClass,
} from "@/lib/lapWatch/livercSessionIndexParsers";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";

export type ScanDayUrlIndexKind = "practice" | "results";

export type ScanDayUrlCandidateRow = {
  sessionId: string;
  sessionUrl: string;
  driverName: string;
  /** Wall clock from the list page (e.g. "2:05 PM"), when available. */
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  /**
   * Matches the driver configured in Settings (LiveRC driver name). When the
   * user hasn't set a driver name we surface every row and leave `matchesDriver`
   * `null` so the UI can render a clear "set your driver name in Settings"
   * hint instead of silently filtering.
   */
  matchesDriver: boolean | null;
  /** True when an ImportedLapTimeSession already exists for this URL (so the
   *  picker can mark it as "already imported" and the user can still re-pick). */
  alreadyImported: boolean;
  /** When already imported, set to the linkedRunId if the ImportedLapTimeSession
   *  is already attached to a run (so the user knows it's been saved). */
  linkedRunId: string | null;
};

/**
 * Scan a LiveRC index page for timing session links:
 * - Practice: `/practice/?p=session_list&d=…` → `view_session` rows (filter by LiveRC driver name when set).
 * - Race / results: `/results/…` hub or index → `view_race_result` rows (list pages do not carry per-row
 *   driver names; optional `eventId` narrows by the event's configured race class list).
 *
 * Returns candidate rows for the Lap Times URL picker; import is handled by `/api/lap-time-sessions/import`.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { dayUrl?: string; eventId?: string | null }
    | null;
  const dayUrl = body?.dayUrl?.trim() ?? "";
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (!dayUrl) {
    return NextResponse.json({ error: "dayUrl is required" }, { status: 400 });
  }
  const isPractice = isLiveRcPracticeListUrl(dayUrl);
  const isResults = isLiveRcResultsDiscoveryUrl(dayUrl);
  if (!isPractice && !isResults) {
    return NextResponse.json(
      {
        error:
          "Unsupported LiveRC URL. Use a practice session list (/practice/?p=session_list&d=YYYY-MM-DD) or a results page (/results/…) that lists timing sessions.",
      },
      { status: 400 }
    );
  }

  let eventRaceClassField: string | null = null;
  if (eventId && isResults) {
    const ev = await prisma.event.findFirst({
      where: { id: eventId, userId: user.id },
      select: { raceClass: true },
    });
    const rc = ev?.raceClass?.trim();
    eventRaceClassField = rc && rc.length > 0 ? rc : null;
  }

  const fetched = await fetchUrlText(dayUrl);
  if (!fetched.ok) {
    return NextResponse.json(
      { error: `Failed to fetch day page: ${fetched.error}` },
      { status: 502 }
    );
  }

  const indexKind: ScanDayUrlIndexKind = isPractice ? "practice" : "results";
  const liveRcDriverName = await getLiveRcDriverNameSetting(user.id);
  const driverNorm = liveRcDriverName
    ? normalizeLiveRcDriverNameForMatch(liveRcDriverName)
    : "";

  let candidates: ScanDayUrlCandidateRow[];

  if (isPractice) {
    const rows = extractPracticeSessions(fetched.text, dayUrl);
    const urls = rows.map((r) => r.sessionUrl).filter(Boolean);
    const alreadyImported = urls.length
      ? await prisma.importedLapTimeSession.findMany({
          where: { userId: user.id, sourceUrl: { in: urls } },
          select: { sourceUrl: true, linkedRunId: true },
        })
      : [];
    const importedMap = new Map<string, string | null>();
    for (const r of alreadyImported) {
      importedMap.set(r.sourceUrl, r.linkedRunId);
    }

    candidates = rows.map((r) => {
      const normRow = normalizeLiveRcDriverNameForMatch(r.driverName);
      const matchesDriver =
        driverNorm.length === 0 ? null : normRow.length > 0 && normRow === driverNorm;
      const linkedRunId = importedMap.get(r.sessionUrl) ?? null;
      return {
        sessionId: r.sessionId,
        sessionUrl: r.sessionUrl,
        driverName: r.driverName,
        sessionTime: r.sessionTime ?? null,
        sessionCompletedAtIso: r.sessionCompletedAtIso,
        matchesDriver,
        alreadyImported: importedMap.has(r.sessionUrl),
        linkedRunId,
      };
    });
  } else {
    let raceRows = extractRaceSessions(fetched.text, dayUrl);
    if (eventRaceClassField) {
      const configuredClasses = eventRaceClassField;
      const narrowed = raceRows.filter((r) =>
        raceListRowMatchesAnyConfiguredClass(r, configuredClasses)
      );
      if (narrowed.length > 0) raceRows = narrowed;
    }

    const urls = raceRows.map((r) => r.sessionUrl).filter(Boolean);
    const alreadyImported = urls.length
      ? await prisma.importedLapTimeSession.findMany({
          where: { userId: user.id, sourceUrl: { in: urls } },
          select: { sourceUrl: true, linkedRunId: true },
        })
      : [];
    const importedMap = new Map<string, string | null>();
    for (const r of alreadyImported) {
      importedMap.set(r.sourceUrl, r.linkedRunId);
    }

    candidates = raceRows.map((r) => {
      const label =
        (r.listLinkText && r.listLinkText.trim()) ||
        (r.raceClass && r.raceClass.trim()) ||
        "Race session";
      const linkedRunId = importedMap.get(r.sessionUrl) ?? null;
      return {
        sessionId: r.sessionId,
        sessionUrl: r.sessionUrl,
        driverName: label,
        sessionTime: r.sessionTime ?? null,
        sessionCompletedAtIso: r.sessionCompletedAtIso,
        matchesDriver: null,
        alreadyImported: importedMap.has(r.sessionUrl),
        linkedRunId,
      };
    });
  }

  const mine = candidates.filter((c) => c.matchesDriver === true);
  return NextResponse.json({
    ok: true,
    dayUrl,
    indexKind,
    liveRcDriverName,
    candidates: mine.length > 0 ? mine : candidates,
    totalCandidates: candidates.length,
    hasDriverNameSetting: Boolean(liveRcDriverName),
  });
}
