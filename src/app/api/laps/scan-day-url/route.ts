import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  extractPracticeSessions,
  isLiveRcPracticeListUrl,
} from "@/lib/lapWatch/livercSessionIndexParsers";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";

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
 * Scan a practice-day results URL (e.g. LiveRC `/practice/?p=session_list&d=…`)
 * for sessions belonging to the current user's configured LiveRC driver name
 * that haven't been saved to a run yet. Returns candidate session rows the
 * Lap Times "url" picker can render; actual import is handled by
 * `/api/lap-time-sessions/import` once the user selects a session.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { dayUrl?: string } | null;
  const dayUrl = body?.dayUrl?.trim() ?? "";
  if (!dayUrl) {
    return NextResponse.json({ error: "dayUrl is required" }, { status: 400 });
  }
  if (!isLiveRcPracticeListUrl(dayUrl)) {
    return NextResponse.json(
      {
        error:
          "Only LiveRC practice day URLs are supported so far (format: /practice/?p=session_list&d=YYYY-MM-DD).",
      },
      { status: 400 }
    );
  }

  const fetched = await fetchUrlText(dayUrl);
  if (!fetched.ok) {
    return NextResponse.json(
      { error: `Failed to fetch day page: ${fetched.error}` },
      { status: 502 }
    );
  }

  const rows = extractPracticeSessions(fetched.text, dayUrl);
  const liveRcDriverName = await getLiveRcDriverNameSetting(user.id);
  const driverNorm = liveRcDriverName
    ? normalizeLiveRcDriverNameForMatch(liveRcDriverName)
    : "";

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

  const candidates: ScanDayUrlCandidateRow[] = rows.map((r) => {
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

  const mine = candidates.filter((c) => c.matchesDriver === true);
  return NextResponse.json({
    ok: true,
    dayUrl,
    liveRcDriverName,
    candidates: mine.length > 0 ? mine : candidates,
    totalCandidates: candidates.length,
    hasDriverNameSetting: Boolean(liveRcDriverName),
  });
}
