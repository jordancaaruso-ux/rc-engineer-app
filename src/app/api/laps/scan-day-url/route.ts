import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  extractPracticeSessions,
  extractRaceSessions,
  isLiveRcPracticeListUrl,
  isLiveRcResultsDiscoveryUrl,
  raceListRowMatchesAnyConfiguredClass,
} from "@/lib/lapWatch/livercSessionIndexParsers";
import {
  formatLiveRcDriverNamesForDisplay,
  liveRcPracticeRowIsMine,
  normalizeLiveRcDriverNameForMatch,
} from "@/lib/lapWatch/liveRcNameNormalize";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { discoverTrackTimingSessions } from "@/lib/lapWatch/discoverTrackTimingSessions";
import {
  sessionCompletedAtIsoFromImportedPayload,
  sessionUtcOffsetMinutesFromImportedPayload,
} from "@/lib/lapImport/fromPayload";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
import {
  getSpeedhiveTransponderNumbersForUser,
  hasSpeedhiveIdentityForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { getTimeZoneFromCookies } from "@/lib/requestTimeZone";
import { emptyLapDiscoveryStatus } from "@/lib/lapWatch/lapDiscoveryStatus";

export const dynamic = "force-dynamic";
// Same LiveRC discovery crawl as /discover-sessions — give it the full serverless headroom so a slow
// live-event LiveRC returns partial results instead of a dropped request.
export const maxDuration = 60;

export type ScanDayUrlIndexKind = "practice" | "results";

export type ScanDayUrlCandidateRow = {
  sessionId: string;
  sessionUrl: string;
  driverName: string;
  /** Wall clock from the list page (e.g. "2:05 PM"), when available. */
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  /** Speedhive practice: the track's offset from UTC, so the day and the race read on its clock. */
  sessionUtcOffsetMinutes?: number | null;
  /**
   * Practice: true when this row matches Settings → Name on LiveRC (exact normalized string,
   * or multi-token relaxed match — see route). Results list rows always null (no per-row driver).
   */
  matchesDriver: boolean | null;
  /** True when an ImportedLapTimeSession already exists for this URL (so the
   *  picker can mark it as "already imported" and the user can still re-pick). */
  alreadyImported: boolean;
  /** When already imported, set to the linkedRunId if the ImportedLapTimeSession
   *  is already attached to a run (so the user knows it's been saved). */
  linkedRunId: string | null;
  timingSource?: "liverc" | "speedhive" | "myrcm";
  bestLapSeconds?: number | null;
  /** Timed laps in the session, when known before import (Speedhive practice; stored parses). */
  lapCount?: number | null;
  /**
   * Only on already-imported rows: what that import is currently filed under, so the picker can say
   * "on Run 12 · Sat afternoon" rather than making the driver guess whether taking it costs them
   * something. Null when the import is sitting loose (the run it was on was deleted, or it was
   * never attached to one).
   */
  linkedRunLabel?: string | null;
};

/**
 * Sessions here that this driver has imported before.
 *
 * These used to be dropped on the floor: the picker was fed `unimportedCandidates` only, so a lap
 * set you'd already pulled in simply vanished from the list. Import itself has always been
 * idempotent, and deleting a run leaves its timing session behind rather than taking it along — so
 * the laps were never gone, just unreachable. This is the door back to them.
 */
export type ScanDayUrlImportedRow = ScanDayUrlCandidateRow & {
  importedSessionId: string;
  linkedRunLabel: string | null;
  /**
   * The run it is filed under was created by the app from the timing sheet ("Add N other runs
   * from today") and the driver has not opened it. The picker offers to OPEN that run rather
   * than take its laps onto a new one — the run exists precisely so it can be filled in.
   */
  linkedRunUnconfirmed: boolean;
};

const RESULTS_SCAN_ROW_CAP = 80;

function timingSourceFromParserId(parserId: string): "liverc" | "speedhive" | "myrcm" | undefined {
  const id = parserId.toLowerCase();
  if (id.includes("speedhive")) return "speedhive";
  if (id.includes("liverc")) return "liverc";
  if (id.includes("myrcm")) return "myrcm";
  return undefined;
}

async function linkedScanCandidatesForRun(
  userId: string,
  runId: string
): Promise<ScanDayUrlCandidateRow[]> {
  const rows = await prisma.importedLapTimeSession.findMany({
    where: { userId, linkedRunId: runId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sourceUrl: true,
      parserId: true,
      sessionCompletedAt: true,
      parsedPayload: true,
    },
  });

  return rows.map((sess) => {
    const drivers = rawSessionDriversFromImportedPayload(sess.parsedPayload) ?? [];
    const primary = drivers[0];
    const laps = primary?.laps ?? [];
    const bestLapSeconds =
      laps.length > 0 ? Math.min(...laps.filter((n) => Number.isFinite(n) && n > 0)) : null;
    const sessionCompletedAtIso =
      sess.sessionCompletedAt?.toISOString() ??
      sessionCompletedAtIsoFromImportedPayload(sess.parsedPayload);
    return {
      sessionId: sess.id,
      sessionUrl: sess.sourceUrl,
      driverName: primary?.driverName?.trim() || sess.sourceUrl,
      sessionTime: null,
      sessionCompletedAtIso,
      sessionUtcOffsetMinutes: sessionUtcOffsetMinutesFromImportedPayload(sess.parsedPayload),
      matchesDriver: true,
      alreadyImported: true,
      linkedRunId: runId,
      timingSource: timingSourceFromParserId(sess.parserId),
      bestLapSeconds: Number.isFinite(bestLapSeconds) ? bestLapSeconds : null,
      lapCount: laps.length > 0 ? laps.length : null,
    };
  });
}

/**
 * The already-imported half of a scan, with the run each import is filed under.
 *
 * Two queries rather than a join through `linkedRunId`: the run label wants `sessionLabel` /
 * meeting fields that only `formatRunSessionDisplay` knows how to combine, and the set is small
 * (one track, one day) so the second lookup is cheap.
 */
async function importedRowsForScan(
  userId: string,
  candidates: {
    sessionId: string;
    sessionUrl: string;
    label: string;
    sessionCompletedAtIso: string | null;
    sessionUtcOffsetMinutes?: number | null;
    bestLapSeconds?: number | null;
    lapCount?: number | null;
    timingSource?: "liverc" | "speedhive" | "myrcm";
    alreadyImported: boolean;
  }[],
  excludeRunId: string | null
): Promise<ScanDayUrlImportedRow[]> {
  const urls = [
    ...new Set(
      candidates.filter((c) => c.alreadyImported).map((c) => c.sessionUrl.trim()).filter(Boolean)
    ),
  ];
  if (urls.length === 0) return [];

  const imports = await prisma.importedLapTimeSession.findMany({
    where: { userId, sourceUrl: { in: urls } },
    select: { id: true, sourceUrl: true, linkedRunId: true },
  });
  const byUrl = new Map(imports.map((i) => [i.sourceUrl.trim(), i]));

  const runIds = [...new Set(imports.map((i) => i.linkedRunId).filter(Boolean) as string[])];
  const runs =
    runIds.length > 0
      ? await prisma.run.findMany({
          where: { id: { in: runIds }, userId },
          select: {
            id: true,
            sessionType: true,
            meetingSessionType: true,
            meetingSessionCode: true,
            sessionLabel: true,
            sessionCompletedAt: true,
            sortAt: true,
            trackNameSnapshot: true,
            unconfirmedAt: true,
          },
        })
      : [];
  const runById = new Map(runs.map((r) => [r.id, r]));
  const viewerTimeZone = runs.length > 0 ? await getTimeZoneFromCookies().catch(() => null) : null;

  const rows: ScanDayUrlImportedRow[] = [];
  for (const c of candidates) {
    if (!c.alreadyImported) continue;
    const imp = byUrl.get(c.sessionUrl.trim());
    if (!imp) continue;
    // The run being edited already shows its own imports as attached strips above the picker.
    // Listing them here too drew the same session twice, and the second copy couldn't be acted on.
    if (excludeRunId && imp.linkedRunId === excludeRunId) continue;
    const run = imp.linkedRunId ? runById.get(imp.linkedRunId) : null;
    rows.push({
      sessionId: c.sessionId,
      sessionUrl: c.sessionUrl,
      driverName: c.label,
      sessionTime: null,
      sessionCompletedAtIso: c.sessionCompletedAtIso,
      sessionUtcOffsetMinutes: c.sessionUtcOffsetMinutes ?? null,
      matchesDriver: true,
      alreadyImported: true,
      linkedRunId: imp.linkedRunId,
      timingSource: c.timingSource,
      bestLapSeconds: c.bestLapSeconds ?? null,
      lapCount: c.lapCount ?? null,
      importedSessionId: imp.id,
      linkedRunLabel: run ? runDisplayLabel(run, viewerTimeZone) : null,
      linkedRunUnconfirmed: run?.unconfirmedAt != null,
    });
  }
  return rows;
}

/**
 * "Qualifying 2 · Sat 16 Aug" — enough for a driver to recognise which run they'd be taking it
 * off. The unconfirmed state is NOT appended here: the picker says it in its own words, and as a
 * suffix it was the half of the line that truncated on a phone ("On Run · Mon, 13 Oct · Unco…").
 */
function runDisplayLabel(
  run: {
    sessionType: string;
    meetingSessionType: string | null;
    meetingSessionCode: string | null;
    sessionLabel: string | null;
    sessionCompletedAt: Date | null;
    sortAt: Date;
    trackNameSnapshot: string | null;
  },
  timeZone: string | null
): string {
  const session = formatRunSessionDisplay(run, { fallback: "Run" });
  const when = run.sessionCompletedAt ?? run.sortAt;
  const day = when.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    // The viewer's day, not the server's (UTC): a Saturday race in Christchurch is still Friday
    // in UTC, and the label read "On Run · Fri, 21 Aug" for a 22 Aug race (test drive, 2026-09-26).
    ...(timeZone ? { timeZone } : {}),
  });
  return [session, day].filter(Boolean).join(" · ");
}

function mergeLinkedScanCandidates(
  linked: ScanDayUrlCandidateRow[],
  discovered: ScanDayUrlCandidateRow[]
): ScanDayUrlCandidateRow[] {
  const linkedUrls = new Set(linked.map((c) => c.sessionUrl.trim()));
  const others = discovered.filter((c) => !linkedUrls.has(c.sessionUrl.trim()));
  return [...linked, ...others];
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
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | {
        dayUrl?: string;
        eventId?: string | null;
        trackId?: string | null;
        runId?: string | null;
        todayStartIso?: string | null;
      }
    | null;
  const dayUrl = body?.dayUrl?.trim() ?? "";
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";
  const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
  const todayStartIso = typeof body?.todayStartIso === "string" ? body.todayStartIso.trim() : "";

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
      // Answered, not rejected. A track with no timing page is an ordinary thing to find and it has
      // its own card ("add a timing page"); as a 400 the client could only read it as a failed
      // request and offered "try again", which will never help.
      return NextResponse.json({
        ok: true,
        dayUrl: null,
        indexKind: "practice" as ScanDayUrlIndexKind,
        liveRcDriverName: null,
        candidates: [],
        olderCandidates: [],
        importedCandidates: [],
        olderCount: 0,
        totalCandidates: 0,
        unimportedCount: 0,
        matchedCount: 0,
        hasDriverNameSetting: false,
        driverFilterApplied: false,
        status: emptyLapDiscoveryStatus("no_timing_page", "liverc", { sources: [] }),
        scanMessage: "This track has no timing page saved.",
        discoveredFromTrack: true,
        hasLiveRc: false,
        hasSpeedhive: false,
      });
    }
    let eventRaceClass: string | null = null;
    if (eventId) {
      const ev = await prisma.event.findFirst({
        where: { id: eventId },
        select: { raceClass: true },
      });
      eventRaceClass = ev?.raceClass?.trim() || null;
    }
    let discovered: Awaited<ReturnType<typeof discoverTrackTimingSessions>>;
    let speedhiveIdentity: boolean;
    try {
      [discovered, speedhiveIdentity] = await Promise.all([
        discoverTrackTimingSessions({
          userId: userId,
          liveRcUrl: liveRcUrl || null,
          speedhiveUrl: speedhiveUrl || null,
          eventRaceClass,
          visibleSinceIso: todayStartIso || null,
        }),
        speedhiveUrl ? hasSpeedhiveIdentityForUser(userId) : Promise.resolve(false),
      ]);
    } catch (err) {
      // A timing site that refuses a burst of scans is a busy site, not a broken one. Answered
      // as the card's "couldn't reach" state (with its retry) rather than a 500 that the client
      // can only read as a failed request — seen on a real drive of three runs in a row.
      console.warn("[scan-day-url] discovery failed", err instanceof Error ? err.message : err);
      const sources: ("liverc" | "speedhive")[] = [
        ...(liveRcUrl ? (["liverc"] as const) : []),
        ...(speedhiveUrl ? (["speedhive"] as const) : []),
      ];
      return NextResponse.json({
        ok: true,
        dayUrl: liveRcUrl || speedhiveUrl,
        indexKind: "practice" as ScanDayUrlIndexKind,
        liveRcDriverName: null,
        candidates: [],
        olderCandidates: [],
        importedCandidates: [],
        olderCount: 0,
        totalCandidates: 0,
        unimportedCount: 0,
        matchedCount: 0,
        hasDriverNameSetting: true,
        driverFilterApplied: true,
        status: emptyLapDiscoveryStatus("unreachable", sources[0] ?? "liverc", {
          sources,
          timingPages: [
            ...(liveRcUrl ? [{ source: "liverc" as const, url: liveRcUrl }] : []),
            ...(speedhiveUrl ? [{ source: "speedhive" as const, url: speedhiveUrl }] : []),
          ],
        }),
        scanMessage: null,
        discoveredFromTrack: true,
        hasLiveRc: Boolean(liveRcUrl),
        hasSpeedhive: Boolean(speedhiveUrl),
      });
    }
    const hasDriverNameSetting = Boolean(
      (liveRcUrl && discovered.liveRcDriverName?.trim()) || (speedhiveUrl && speedhiveIdentity)
    );
    const toCandidateRow = (c: (typeof discovered.unimportedCandidates)[number]): ScanDayUrlCandidateRow => ({
      sessionId: c.sessionId,
      sessionUrl: c.sessionUrl,
      driverName: c.label,
      sessionTime: null,
      sessionCompletedAtIso: c.sessionCompletedAtIso,
      sessionUtcOffsetMinutes: c.sessionUtcOffsetMinutes ?? null,
      matchesDriver: true,
      alreadyImported: c.alreadyImported,
      linkedRunId: c.linkedRunId,
      timingSource: c.timingSource,
      bestLapSeconds: c.bestLapSeconds ?? null,
      lapCount: c.lapCount ?? null,
    });
    const discoveredCandidates: ScanDayUrlCandidateRow[] = discovered.unimportedCandidates.map(toCandidateRow);
    const olderCandidates: ScanDayUrlCandidateRow[] = discovered.olderUnimportedCandidates.map(toCandidateRow);
    const linkedCandidates =
      runId && (await prisma.run.findFirst({ where: { id: runId, userId: userId }, select: { id: true } }))
        ? await linkedScanCandidatesForRun(userId, runId)
        : [];
    const candidates = mergeLinkedScanCandidates(linkedCandidates, discoveredCandidates);
    // Fed the matched sessions *and* the day's own list. A driver whose name doesn't match takes
    // their session out of the day list — and that session is not a "candidate", so building this
    // from candidates alone made exactly those laps vanish again on the next scan, which is the
    // whole failure this list exists to end.
    const importedRows = await importedRowsForScan(
      userId,
      [
        ...discovered.candidates,
        ...(discovered.status?.sessionsToday ?? []).map((s) => ({
          sessionId: s.sessionId,
          sessionUrl: s.sessionUrl,
          label: s.label,
          sessionCompletedAtIso: s.sessionCompletedAtIso,
          bestLapSeconds: null,
          timingSource: s.source,
          alreadyImported: true,
        })),
      ],
      runId ?? null
    );
    return NextResponse.json({
      importedCandidates: importedRows,
      status: discovered.status,
      ok: true,
      dayUrl: liveRcUrl || speedhiveUrl,
      indexKind: "practice" as ScanDayUrlIndexKind,
      liveRcDriverName: discovered.liveRcDriverName,
      candidates,
      olderCandidates,
      olderCount: discovered.olderUnimportedTotal,
      totalCandidates: discovered.candidates.length,
      unimportedCount: discovered.unimportedTotal,
      matchedCount: candidates.length,
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

  // MyRCM discovery was removed on 2026-08-26 — see `timingUrlSafetySync.ts`. A pasted MyRCM URL
  // now falls through to the unsupported-URL answer below rather than being crawled.
  const isPractice = isLiveRcPracticeListUrl(dayUrl);
  const isResults = isLiveRcResultsDiscoveryUrl(dayUrl);
  if (!isPractice && !isResults) {
    return NextResponse.json(
      {
        error:
          "Unsupported timing URL. Use a LiveRC practice list or results page, or a Speedhive session URL.",
      },
      { status: 400 }
    );
  }

  let eventRaceClassField: string | null = null;
  if (eventId && isResults) {
    const ev = await prisma.event.findFirst({
      where: { id: eventId },
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
  const liveRcDriverName = await getLiveRcDriverNameSetting(userId);
  const driverNorm = liveRcDriverName
    ? normalizeLiveRcDriverNameForMatch(liveRcDriverName)
    : "";

  let candidates: ScanDayUrlCandidateRow[];

  if (isPractice) {
    const rows = extractPracticeSessions(fetched.text, dayUrl);
    const urls = rows.map((r) => r.sessionUrl).filter(Boolean);
    const alreadyImported = urls.length
      ? await prisma.importedLapTimeSession.findMany({
          where: { userId: userId, sourceUrl: { in: urls } },
          select: { sourceUrl: true, linkedRunId: true },
        })
      : [];
    const importedMap = new Map<string, string | null>();
    for (const r of alreadyImported) {
      importedMap.set(r.sourceUrl, r.linkedRunId);
    }

    // A saved chip printed on the row is the driver's run whatever name the club typed.
    const transponders = await getSpeedhiveTransponderNumbersForUser(userId).catch(() => [] as number[]);
    candidates = rows.map((r) => {
      const matchesDriver =
        driverNorm.length === 0 ? null : liveRcPracticeRowIsMine(r.driverName, driverNorm, transponders);
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
          where: { userId: userId, sourceUrl: { in: urls } },
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
      scanMessage: `No practice sessions matched your name on LiveRC “${formatLiveRcDriverNamesForDisplay(liveRcDriverName)}”. Check Settings → Name on LiveRC against how your name appears on LiveRC.${sampleHint}`,
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
        "Set your name on LiveRC in Settings to list only your practice sessions. Until then, every session on this day page is shown.",
    });
  }

  // Results index: no per-row driver filter; cap row count and explain.
  const truncated = candidates.length > RESULTS_SCAN_ROW_CAP;
  const capped = truncated ? candidates.slice(0, RESULTS_SCAN_ROW_CAP) : candidates;
  let scanMessage: string | null = null;
  if (indexKind === "results") {
    scanMessage =
      "Results pages list sessions by class or round — your name on LiveRC does not filter this list. Pick your session, then confirm your row on the timing page.";
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
