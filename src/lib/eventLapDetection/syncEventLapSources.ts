import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { importOneTimingUrl } from "@/lib/lapImport/service";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import { extractPracticeSessions, extractRaceSessions } from "@/lib/lapWatch/livercSessionIndexParsers";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";
import { enrichImportedSessionForWatch } from "@/lib/lapWatch/enrichImportedSessionForWatch";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import { buildImportedIngestPlanFromPayload } from "@/lib/lapImport/importedIngestPlan";
import type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";
import { eventIsActiveOnLocalToday } from "@/lib/eventActive";

export type { DetectedRunPrompt } from "@/lib/detectedRunPrompt";

function maxDate(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return a.getTime() >= b.getTime() ? a : b;
}

function isLiveRcPracticeListUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!/\.liverc\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!path.endsWith("/practice")) return false;
    const p = (u.searchParams.get("p") ?? "").toLowerCase();
    return p === "session_list";
  } catch {
    return false;
  }
}

function isLiveRcResultsIndexUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!/\.liverc\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    return path.endsWith("/results") && !u.searchParams.get("id");
  } catch {
    return false;
  }
}

/**
 * Import new LiveRC sessions for events that configure practice/results URLs.
 * Scoped to calendar-active events, else the single most recent event.
 */
export async function syncRecentEventLapSources(userId: string): Promise<void> {
  const liveName = (await getLiveRcDriverNameSetting(userId).catch(() => null))?.trim() ?? "";
  const liveNorm = liveName ? normalizeLiveRcDriverNameForMatch(liveName) : "";

  const candidates = await prisma.event.findMany({
    where: { userId },
    orderBy: { endDate: "desc" },
    take: 24,
    select: {
      id: true,
      startDate: true,
      endDate: true,
      practiceSourceUrl: true,
      resultsSourceUrl: true,
      raceClass: true,
      practiceLastSeenSessionCompletedAt: true,
      resultsLastSeenSessionCompletedAt: true,
    },
  });

  const active = candidates.filter(eventIsActiveOnLocalToday);
  const scoped = active.length > 0 ? active : candidates.slice(0, 1);

  for (const ev of scoped) {
    if (ev.practiceSourceUrl?.trim() && liveNorm) {
      await syncPracticeForEvent(userId, ev, liveNorm, liveName);
    }
    if (ev.resultsSourceUrl?.trim() && ev.raceClass?.trim() && liveName) {
      await syncResultsForEvent(userId, ev, liveNorm, liveName);
    }
  }
}

async function syncPracticeForEvent(
  userId: string,
  ev: {
    id: string;
    practiceSourceUrl: string | null;
    practiceLastSeenSessionCompletedAt: Date | null;
  },
  liveNorm: string,
  liveName: string
): Promise<void> {
  const pageUrl = ev.practiceSourceUrl!.trim();
  if (!isLiveRcPracticeListUrl(pageUrl)) return;

  const fetched = await fetchUrlText(pageUrl);
  if (!fetched.ok) return;

  const practiceListRaw = extractPracticeSessions(fetched.text, pageUrl);
  const lastSeen = ev.practiceLastSeenSessionCompletedAt;

  const withTime = practiceListRaw
    .map((x) => {
      const iso = x.sessionCompletedAtIso?.trim() ? x.sessionCompletedAtIso.trim() : null;
      const dt = iso ? new Date(iso) : null;
      const ok = dt != null && !Number.isNaN(dt.getTime());
      return { ...x, when: ok ? dt! : null, whenOk: ok };
    })
    .sort((a, b) => {
      const ta = a.when?.getTime() ?? 0;
      const tb = b.when?.getTime() ?? 0;
      return tb - ta;
    });

  const importTargets = withTime.filter((d) => {
    if (!d.whenOk) return false;
    if (lastSeen == null) return true;
    return d.when!.getTime() > lastSeen.getTime();
  });

  let maxSeen: Date | null = lastSeen ?? null;
  const capped = importTargets.slice(0, 10);

  for (const t of capped) {
    const imported = await importOneTimingUrl(userId, t.sessionUrl);
    if (imported.success !== true) continue;

    const enriched = await enrichImportedSessionForWatch(userId, imported.importedSessionId, {
      sessionCompletedAtIsoFromDiscovery: t.sessionCompletedAtIso,
    });
    if (!enriched) continue;

    const canonNorm = normalizeLiveRcDriverNameForMatch(enriched.displayDriverName);
    if (canonNorm !== liveNorm) continue;

    const displayIso = enriched.sessionCompletedAtIso;
    const when = displayIso ? new Date(displayIso) : null;
    if (when && !Number.isNaN(when.getTime())) {
      maxSeen = maxDate(maxSeen, when);
    }

    await prisma.importedLapTimeSession.update({
      where: { id: imported.importedSessionId },
      data: {
        linkedEventId: ev.id,
        eventDetectionSource: "practice",
        eventRaceClass: null,
      },
    });
  }

  await prisma.event.update({
    where: { id: ev.id },
    data: { practiceLastSeenSessionCompletedAt: maxSeen ?? undefined },
  });
}

async function syncResultsForEvent(
  userId: string,
  ev: {
    id: string;
    resultsSourceUrl: string | null;
    raceClass: string | null;
    resultsLastSeenSessionCompletedAt: Date | null;
  },
  _liveNorm: string,
  liveName: string
): Promise<void> {
  const pageUrl = ev.resultsSourceUrl!.trim();
  if (!isLiveRcResultsIndexUrl(pageUrl)) return;

  const classNorm = normalizeLiveRcDriverNameForMatch(ev.raceClass!.trim());

  const fetched = await fetchUrlText(pageUrl);
  if (!fetched.ok) return;

  const raceList = extractRaceSessions(fetched.text, pageUrl).filter(
    (r) => normalizeLiveRcDriverNameForMatch(r.raceClass ?? "") === classNorm
  );

  const lastSeen = ev.resultsLastSeenSessionCompletedAt;

  const withTime = raceList
    .map((x) => {
      const iso = x.sessionCompletedAtIso?.trim() ? x.sessionCompletedAtIso.trim() : null;
      const dt = iso ? new Date(iso) : null;
      const ok = dt != null && !Number.isNaN(dt.getTime());
      return { ...x, when: ok ? dt! : null, whenOk: ok };
    })
    .sort((a, b) => {
      const ta = a.when?.getTime() ?? 0;
      const tb = b.when?.getTime() ?? 0;
      return tb - ta;
    });

  const importTargets = withTime.filter((d) => {
    if (!d.whenOk) return false;
    if (lastSeen == null) return true;
    return d.when!.getTime() > lastSeen.getTime();
  });

  let maxSeen: Date | null = lastSeen ?? null;
  const capped = importTargets.slice(0, 10);

  for (const t of capped) {
    const imported = await importOneTimingUrl(userId, t.sessionUrl, { driverName: liveName });
    if (imported.success !== true) continue;

    const enriched = await enrichImportedSessionForWatch(userId, imported.importedSessionId, {
      sessionCompletedAtIsoFromDiscovery: t.sessionCompletedAtIso,
    });
    if (!enriched) continue;

    const displayIso = enriched.sessionCompletedAtIso;
    const when = displayIso ? new Date(displayIso) : null;
    if (when && !Number.isNaN(when.getTime())) {
      maxSeen = maxDate(maxSeen, when);
    }

    await prisma.importedLapTimeSession.update({
      where: { id: imported.importedSessionId },
      data: {
        linkedEventId: ev.id,
        eventDetectionSource: "race",
        eventRaceClass: ev.raceClass!.trim(),
      },
    });
  }

  await prisma.event.update({
    where: { id: ev.id },
    data: { resultsLastSeenSessionCompletedAt: maxSeen ?? undefined },
  });
}

function runIsIncomplete(run: { lapTimes: unknown; notes: string | null }): boolean {
  const laps = run.lapTimes;
  const arr = Array.isArray(laps) ? laps.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : [];
  const hasLaps = arr.length > 0;
  const hasNotes = Boolean(run.notes?.trim());
  return !hasLaps || !hasNotes;
}

/** Build dashboard prompts after optional sync (caller runs sync first). */
export async function loadDetectedRunPrompts(userId: string): Promise<DetectedRunPrompt[]> {
  const liveRcDriverName = (await getLiveRcDriverNameSetting(userId).catch(() => null))?.trim() ?? null;

  const candidates = await prisma.event.findMany({
    where: { userId },
    orderBy: { endDate: "desc" },
    take: 24,
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  const active = candidates.filter(eventIsActiveOnLocalToday);
  const scoped = active.length > 0 ? active : candidates.slice(0, 1);
  const scopedIds = scoped.map((e) => e.id);
  const eventNameById = new Map(scoped.map((e) => [e.id, e.name] as const));

  if (scopedIds.length === 0) return [];

  const sessions = await prisma.importedLapTimeSession.findMany({
    where: {
      userId,
      linkedEventId: { in: scopedIds },
      eventDetectionSource: { in: ["practice", "race"] },
    },
    select: {
      id: true,
      linkedEventId: true,
      parsedPayload: true,
      sessionCompletedAt: true,
      createdAt: true,
      eventDetectionSource: true,
      eventRaceClass: true,
      linkedRunId: true,
    },
  });

  const out: DetectedRunPrompt[] = [];

  for (const s of sessions) {
    const eventId = s.linkedEventId!;
    const eventName = eventNameById.get(eventId) ?? "Event";
    const sourceType = s.eventDetectionSource === "race" ? "race" : "practice";

    const enriched = await enrichImportedSessionForWatch(userId, s.id);

    const ingestMode =
      sourceType === "race" ? "race_full_field" : "practice_user_only";
    const plan = buildImportedIngestPlanFromPayload(s.parsedPayload, {
      mode: ingestMode,
      liveRcDriverName,
    });
    const displayDriverName =
      plan?.primaryDriverName?.trim() ||
      enriched?.displayDriverName?.trim() ||
      "Driver";
    const lapCount = plan ? plan.primaryRows.length : enriched?.lapCount ?? null;
    const bestLapSeconds = plan
      ? plan.primaryRows.length > 0
        ? Math.min(...plan.primaryRows.map((r) => r.lapTimeSeconds))
        : null
      : enriched?.bestLapSeconds ?? null;

    const sessionCompletedAtIso = resolveImportedSessionDisplayTimeIso({
      sessionCompletedAt: s.sessionCompletedAt,
      parsedPayload: s.parsedPayload,
      createdAt: s.createdAt,
    });

    const orClause: Array<{ importedLapTimeSessionId: string } | { id: string }> = [
      { importedLapTimeSessionId: s.id },
    ];
    if (s.linkedRunId) orClause.push({ id: s.linkedRunId });

    const run = await prisma.run.findFirst({
      where: { userId, OR: orClause },
      select: { id: true, lapTimes: true, notes: true },
    });

    if (run && !runIsIncomplete(run)) continue;

    const isIncomplete = run ? runIsIncomplete(run) : false;
    const promptKind: "log_new" | "finish" = run ? "finish" : "log_new";

    out.push({
      eventId,
      eventName,
      importedLapTimeSessionId: s.id,
      sourceType,
      sessionCompletedAtIso,
      displayDriverName,
      className: sourceType === "race" ? s.eventRaceClass?.trim() ?? null : null,
      lapCount,
      bestLapSeconds,
      runId: run?.id ?? null,
      isIncomplete,
      promptKind,
    });
  }

  out.sort((a, b) => new Date(b.sessionCompletedAtIso).getTime() - new Date(a.sessionCompletedAtIso).getTime());
  return out;
}
