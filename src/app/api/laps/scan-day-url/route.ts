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
import { discoverTrackTimingSessions } from "@/lib/lapWatch/discoverTrackTimingSessions";
import { hasSpeedhiveIdentityForUser } from "@/lib/speedhive/speedhiveDriverSettings";

export type ScanDayUrlIndexKind = "practice" | "results";

export type ScanDayUrlCandidateRow = {
  sessionId: string;
  sessionUrl: string;
  driverName: string;
  /** Wall clock from the list page (e.g. "2:05 PM"), when available. */
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  /**
   * Practice: true when this row matches Settings → LiveRC driver name (exact normalized string,
   * or multi-token relaxed match — see route). Results list rows always null (no per-row driver).
   */
  matchesDriver: boolean | null;
  /** True when an ImportedLapTimeSession already exists for this URL (so the
   *  picker can mark it as "already imported" and the user can still re-pick). */
  alreadyImported: boolean;
  /** When already imported, set to the linkedRunId if the ImportedLapTimeSession
   *  is already attached to a run (so the user knows it's been saved). */
  linkedRunId: string | null;
  timingSource?: "liverc" | "speedhive";
  bestLapSeconds?: number | null;
};

const RESULTS_SCAN_ROW_CAP = 80;

/** True when every normalized token (length ≥2) from the setting appears in the row string (order-independent). */
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
    | { dayUrl?: string; eventId?: string | null; trackId?: string | null }
    | null;
  const dayUrl = body?.dayUrl?.trim() ?? "";
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";

  if (!dayUrl && trackId) {
    const track = await prisma.track.findFirst({
      where: { id: trackId },
      select: { liveRcUrl: true, speedhiveUrl: true },
    });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }
    const liveRcUrl = track.liveRcUrl?.trim() ?? "";
    const speedhiveUrl = track.speedhiveUrl?.trim() ?? "";
    if (!liveRcUrl && !speedhiveUrl) {
      return NextResponse.json(
        {
          error: "Add a LiveRC or Speedhive organization URL on the track page.",
        },
        { status: 400 }
      );
    }
    let eventRaceClass: string | null = null;
    if (eventId) {
      const ev = await prisma.event.findFirst({
        where: { id: eventId, userId: user.id },
        select: { raceClass: true },
      });
      eventRaceClass = ev?.raceClass?.trim() || null;
    }
    const [discovered, speedhiveIdentity] = await Promise.all([
      discoverTrackTimingSessions({
        userId: user.id,
        liveRcUrl: liveRcUrl || null,
        speedhiveUrl: speedhiveUrl || null,
        eventRaceClass,
      }),
      speedhiveUrl ? hasSpeedhiveIdentityForUser(user.id) : Promise.resolve(false),
    ]);
    const hasDriverNameSetting = Boolean(
      (liveRcUrl && discovered.liveRcDriverName?.trim()) || (speedhiveUrl && speedhiveIdentity)
    );
    const displaySessions = discovered.unimportedCandidates;
    const candidates: ScanDayUrlCandidateRow[] = displaySessions.map((c) => ({
      sessionId: c.sessionId,
      sessionUrl: c.sessionUrl,
      driverName: c.label,
      sessionTime: null,
      sessionCompletedAtIso: c.sessionCompletedAtIso,
      matchesDriver: true,
      alreadyImported: c.alreadyImported,
      linkedRunId: c.linkedRunId,
      timingSource: c.timingSource,
      bestLapSeconds: c.bestLapSeconds ?? null,
    }));
    return NextResponse.json({
      ok: true,
      dayUrl: liveRcUrl || speedhiveUrl,
      indexKind: "practice" as ScanDayUrlIndexKind,
      liveRcDriverName: discovered.liveRcDriverName,
      candidates,
      totalCandidates: discovered.candidates.length,
      unimportedCount: discovered.unimportedTotal,
      matchedCount: displaySessions.length,
      hasDriverNameSetting,
      driverFilterApplied: true,
      scanMessage: discovered.hint,
      discoveredFromTrack: true,
      mostRecentSessionUrl: discovered.mostRecentSession?.sessionUrl ?? null,
      activeRaceMeeting: discovered.activeRaceMeeting,
      discoveryDebug: discovered.liveRcDebug,
      hasLiveRc: Boolean(liveRcUrl),
      hasSpeedhive: Boolean(speedhiveUrl),
    });
  }

  if (!dayUrl) {
    return NextResponse.json({ error: "dayUrl or trackId is required" }, { status: 400 });
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
        driverNorm.length === 0 ? null : practiceRowMatchesDriver(normRow, driverNorm);
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

  const totalCandidates = candidates.length;

  if (isPractice && driverNorm.length > 0) {
    const mine = candidates.filter((c) => c.matchesDriver === true);
    if (mine.length > 0) {
      return NextResponse.json({
        ok: true,
        dayUrl,
        indexKind,
        liveRcDriverName,
        candidates: mine,
        totalCandidates,
        matchedCount: mine.length,
        hasDriverNameSetting: true,
        driverFilterApplied: true,
        scanMessage: null,
      });
    }
    const sampleLabels = [...new Set(candidates.map((c) => c.driverName).filter(Boolean))].slice(0, 8);
    const sampleHint =
      sampleLabels.length > 0
        ? ` Example names on this page: ${sampleLabels.join(" · ")}.`
        : "";
    return NextResponse.json({
      ok: true,
      dayUrl,
      indexKind,
      liveRcDriverName,
      candidates: [],
      totalCandidates,
      matchedCount: 0,
      hasDriverNameSetting: true,
      driverFilterApplied: true,
      scanMessage: `No practice sessions matched your LiveRC driver name “${liveRcDriverName ?? ""}”. Check Settings → LiveRC driver name against how your name appears on LiveRC.${sampleHint}`,
    });
  }

  if (isPractice && driverNorm.length === 0) {
    return NextResponse.json({
      ok: true,
      dayUrl,
      indexKind,
      liveRcDriverName: null,
      candidates,
      totalCandidates,
      matchedCount: null,
      hasDriverNameSetting: false,
      driverFilterApplied: false,
      scanMessage:
        "Set your LiveRC driver name in Settings to list only your practice sessions. Until then, every session on this day page is shown.",
    });
  }

  // Results index: no per-row driver filter; cap row count and explain.
  const truncated = candidates.length > RESULTS_SCAN_ROW_CAP;
  const capped = truncated ? candidates.slice(0, RESULTS_SCAN_ROW_CAP) : candidates;
  let scanMessage: string | null = null;
  if (indexKind === "results") {
    scanMessage =
      "Results pages list sessions by class or round — your LiveRC driver name does not filter this list. Pick your session, then confirm your row on the timing page.";
    if (truncated) {
      scanMessage += ` Showing first ${RESULTS_SCAN_ROW_CAP} of ${totalCandidates} rows — narrow with an event’s race class when linked.`;
    }
  }

  return NextResponse.json({
    ok: true,
    dayUrl,
    indexKind,
    liveRcDriverName,
    candidates: capped,
    totalCandidates,
    matchedCount: null,
    hasDriverNameSetting: Boolean(liveRcDriverName),
    driverFilterApplied: false,
    scanMessage,
  });
}
