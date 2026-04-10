import "server-only";

import { prisma } from "@/lib/prisma";
import { importOneTimingUrl } from "@/lib/lapImport/service";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  extractPracticeSessions,
  extractRaceSessions,
  filterPracticeSessionsByTargetDriver,
  normalizeLiveRcDriverNameForMatch,
} from "@/lib/lapWatch/livercSessionIndexParsers";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import { enrichImportedSessionForWatch } from "@/lib/lapWatch/enrichImportedSessionForWatch";

export type WatchCheckResultRow =
  | {
      sourceId: string;
      sourceUrl: string;
      /** Watched-source target driver (optional); not the canonical display name. */
      driverName: string | null;
      carId: string | null;
      status: "new_imported";
      importedSessionId: string;
      /** Canonical timing URL from ImportedLapTimeSession.sourceUrl after import. */
      importedFromUrl: string;
      sessionId: string;
      /** Display time (ISO) — from DB + payload, same as lap import library. */
      sessionCompletedAtIso: string | null;
      parserId: string;
      message: string | null;
      /** Canonical driver label from imported session parsed payload. */
      displayDriverName: string;
      lapCount: number | null;
      bestLapSeconds: number | null;
    }
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "no_change";
      message: string | null;
    }
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "no_driver_match";
      message: string;
      parsedCandidateCount: number;
      candidateDriverNamesSample: string[];
    }
  | {
      sourceId: string;
      sourceUrl: string;
      driverName: string | null;
      carId: string | null;
      status: "error";
      error: string;
      parserId: string | null;
    };

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

function maxDate(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return a.getTime() >= b.getTime() ? a : b;
}

export async function checkWatchedLapSources(params: {
  userId: string;
  forceImport?: boolean;
}): Promise<WatchCheckResultRow[]> {
  const sources = await prisma.watchedLapSource.findMany({
    where: { userId: params.userId },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      sourceUrl: true,
      driverName: true,
      carId: true,
      lastSeenSessionCompletedAt: true,
    },
  });

  const out: WatchCheckResultRow[] = [];
  for (const s of sources) {
    try {
      const pageUrl = s.sourceUrl;
      const fetched = await fetchUrlText(pageUrl);
      if (!fetched.ok) {
        await prisma.watchedLapSource.update({ where: { id: s.id }, data: { lastCheckedAt: new Date() } });
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "error",
          error: fetched.error,
          parserId: null,
        });
        continue;
      }

      const lastSeen = s.lastSeenSessionCompletedAt;
      const now = new Date();

      const practiceListRaw = isLiveRcPracticeListUrl(pageUrl) ? extractPracticeSessions(fetched.text, pageUrl) : [];
      const targetDriverTrim = s.driverName?.trim() ?? "";
      const practiceList =
        targetDriverTrim && isLiveRcPracticeListUrl(pageUrl)
          ? filterPracticeSessionsByTargetDriver(practiceListRaw, s.driverName)
          : practiceListRaw;

      if (targetDriverTrim && isLiveRcPracticeListUrl(pageUrl)) {
        const sample = practiceListRaw.slice(0, 12).map((x) => x.driverName);
        console.info("[lap-watch] practice session_list filter", {
          sourceId: s.id,
          parsedCandidateCount: practiceListRaw.length,
          candidateDriverNamesSample: sample,
          normalizedTarget: normalizeLiveRcDriverNameForMatch(targetDriverTrim),
          matchedAfterFilter: practiceList.length,
        });
      }

      if (
        targetDriverTrim &&
        isLiveRcPracticeListUrl(pageUrl) &&
        practiceListRaw.length > 0 &&
        practiceList.length === 0
      ) {
        await prisma.watchedLapSource.update({ where: { id: s.id }, data: { lastCheckedAt: now } });
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "no_driver_match",
          message: `No matching practice sessions for driver "${targetDriverTrim}" on this list.`,
          parsedCandidateCount: practiceListRaw.length,
          candidateDriverNamesSample: practiceListRaw.slice(0, 20).map((x) => x.driverName),
        });
        continue;
      }

      const raceList = isLiveRcResultsIndexUrl(pageUrl) ? extractRaceSessions(fetched.text, pageUrl) : [];

      if (practiceList.length === 0 && raceList.length === 0) {
        await prisma.watchedLapSource.update({ where: { id: s.id }, data: { lastCheckedAt: now } });
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "error",
          error:
            "This watched URL is not a supported LiveRC index page. Use practice session list (`/practice/?p=session_list&d=YYYY-MM-DD`) or results index (`/results/`).",
          parserId: null,
        });
        continue;
      }

      const discovered = [
        ...practiceList.map((x) => ({
          kind: "practice" as const,
          driverName: x.driverName,
          sessionCompletedAtIso: x.sessionCompletedAtIso,
          sessionId: x.sessionId,
          sessionUrl: x.sessionUrl,
        })),
        ...raceList.map((x) => ({
          kind: "race" as const,
          driverName: s.driverName ?? null,
          sessionCompletedAtIso: x.sessionCompletedAtIso,
          sessionId: x.sessionId,
          sessionUrl: x.sessionUrl,
        })),
      ];

      // Sort newest → oldest for matched sessions; time-parseable sessions participate in normal new detection.
      const withTime = discovered
        .map((d) => {
          const iso = d.sessionCompletedAtIso?.trim() ? d.sessionCompletedAtIso.trim() : null;
          const dt = iso ? new Date(iso) : null;
          const ok = dt != null && !Number.isNaN(dt.getTime());
          return { ...d, when: ok ? dt! : null, whenOk: ok };
        })
        .sort((a, b) => {
          const ta = a.when?.getTime() ?? 0;
          const tb = b.when?.getTime() ?? 0;
          return tb - ta;
        });

      const importTargets = withTime.filter((d) => {
        if (params.forceImport === true) return true;
        if (!d.whenOk) return false;
        if (lastSeen == null) return true;
        return d.when!.getTime() > lastSeen.getTime();
      });

      if (importTargets.length === 0) {
        await prisma.watchedLapSource.update({ where: { id: s.id }, data: { lastCheckedAt: now } });
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "no_change",
          message: params.forceImport ? "Force import enabled, but no sessions were discovered on this page." : "No new sessions detected.",
        });
        continue;
      }

      // Safety cap: avoid importing hundreds of old sessions by mistake (newest-first).
      const cappedTargets = importTargets.slice(0, 10);

      let maxSeen: Date | null = lastSeen ?? null;
      for (const t of cappedTargets) {
        const imported = await importOneTimingUrl(params.userId, t.sessionUrl, t.driverName ? { driverName: t.driverName } : undefined);
        if (imported.success !== true) {
          out.push({
            sourceId: s.id,
            sourceUrl: s.sourceUrl,
            driverName: s.driverName ?? null,
            carId: s.carId ?? null,
            status: "error",
            error: imported.error,
            parserId: imported.parserId ?? null,
          });
          continue;
        }

        const enriched = await enrichImportedSessionForWatch(params.userId, imported.importedSessionId, {
          sessionCompletedAtIsoFromDiscovery: t.sessionCompletedAtIso,
        });
        const displayIso = enriched
          ? enriched.sessionCompletedAtIso
          : resolveImportedSessionDisplayTimeIso({
              sessionCompletedAt: imported.sessionCompletedAtDbIso ?? null,
              parsedPayload:
                imported.sessionCompletedAtIso != null && imported.sessionCompletedAtIso.trim()
                  ? { sessionCompletedAtIso: imported.sessionCompletedAtIso.trim() }
                  : undefined,
              createdAt: imported.recordedAt,
              sessionCompletedAtIsoHint: t.sessionCompletedAtIso,
            });
        const importedWhen = displayIso ? new Date(displayIso) : null;
        if (importedWhen && !Number.isNaN(importedWhen.getTime())) {
          maxSeen = maxDate(maxSeen, importedWhen);
        }

        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "new_imported",
          importedSessionId: imported.importedSessionId,
          importedFromUrl: enriched?.timingSourceUrl ?? t.sessionUrl,
          sessionId: t.sessionId,
          sessionCompletedAtIso: displayIso,
          parserId: imported.parserId,
          message: imported.message ?? null,
          displayDriverName: enriched?.displayDriverName ?? t.driverName ?? s.driverName ?? "Session",
          lapCount: enriched?.lapCount ?? (Array.isArray(imported.laps) ? imported.laps.length : null),
          bestLapSeconds:
            enriched?.bestLapSeconds ??
            (Array.isArray(imported.laps) && imported.laps.length > 0
              ? Math.min(...imported.laps.filter((n): n is number => typeof n === "number" && Number.isFinite(n)))
              : null),
        });
      }

      await prisma.watchedLapSource.update({
        where: { id: s.id },
        data: {
          lastCheckedAt: now,
          lastSeenSessionCompletedAt: maxSeen ?? undefined,
        },
      });
    } catch (e) {
      await prisma.watchedLapSource.update({
        where: { id: s.id },
        data: { lastCheckedAt: new Date() },
      });
      out.push({
        sourceId: s.id,
        sourceUrl: s.sourceUrl,
        driverName: s.driverName ?? null,
        carId: s.carId ?? null,
        status: "error",
        error: e instanceof Error ? e.message : "Watch check failed",
        parserId: null,
      });
    }
  }
  return out;
}

