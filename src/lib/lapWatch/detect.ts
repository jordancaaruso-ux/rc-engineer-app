import "server-only";

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { importOneTimingUrl } from "@/lib/lapImport/service";
import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import { extractPracticeSessions, extractRaceSessions } from "@/lib/lapWatch/livercSessionIndexParsers";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";
import { enrichImportedSessionForWatch } from "@/lib/lapWatch/enrichImportedSessionForWatch";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";

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

/** Structured JSON logs for one force-check run (grep: `[lap-watch]`) */
function logWatch(runId: string, phase: string, data: Record<string, unknown>): void {
  console.info(`[lap-watch] ${phase}`, JSON.stringify({ runId, phase, ...data }));
}

export async function checkWatchedLapSources(params: {
  userId: string;
  forceImport?: boolean;
}): Promise<WatchCheckResultRow[]> {
  const runId = randomUUID();
  logWatch(runId, "run_start", { forceImport: params.forceImport === true });

  const userLiveRcDriverName = (await getLiveRcDriverNameSetting(params.userId).catch(() => null)) ?? null;
  const userLiveRcDriverNorm = userLiveRcDriverName ? normalizeLiveRcDriverNameForMatch(userLiveRcDriverName) : "";
  logWatch(runId, "user_identity", { liveRcDriverName: userLiveRcDriverName, normalized: userLiveRcDriverNorm || null });

  const sources = await prisma.watchedLapSource.findMany({
    where: { userId: params.userId },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      sourceUrl: true,
      targetMode: true,
      targetClass: true,
      targetDriverOverride: true,
      driverName: true, // legacy
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
      const legacyDriverTrim = s.driverName?.trim() ?? "";
      const effectiveDriver =
        (typeof s.targetDriverOverride === "string" && s.targetDriverOverride.trim()
          ? s.targetDriverOverride.trim()
          : null) ??
        (s.targetMode === "driver" ? (userLiveRcDriverName?.trim() || null) : null) ??
        (legacyDriverTrim || null);
      const targetDriverTrim = effectiveDriver?.trim() ?? "";
      const targetNorm = targetDriverTrim ? normalizeLiveRcDriverNameForMatch(targetDriverTrim) : "";
      const isPracticeListPage = isLiveRcPracticeListUrl(pageUrl);
      const isResultsIndexPage = isLiveRcResultsIndexUrl(pageUrl);
      const targetMode = (typeof s.targetMode === "string" ? s.targetMode : "none") as "driver" | "class" | "none";
      const targetClassTrim = typeof s.targetClass === "string" ? s.targetClass.trim() : "";
      const targetClassNorm = targetClassTrim ? normalizeLiveRcDriverNameForMatch(targetClassTrim) : "";

      logWatch(runId, "source_targeting", {
        sourceId: s.id,
        targetMode,
        targetClass: targetClassTrim || null,
        effectiveDriverName: targetDriverTrim || null,
      });

      // --- 1) After parsing session-list page ---
      logWatch(runId, "practice_list_parsed", {
        sourceId: s.id,
        parsedRowCount: practiceListRaw.length,
        sampleFirst5ParsedRows: practiceListRaw.slice(0, 5).map((row) => ({
          driverNameRaw: row.driverName,
          sessionId: row.sessionId,
          sessionUrl: row.sessionUrl,
          sessionTime: row.sessionTime,
          sessionCompletedAtIso: row.sessionCompletedAtIso,
        })),
      });

      const raceList = isLiveRcResultsIndexUrl(pageUrl) ? extractRaceSessions(fetched.text, pageUrl) : [];
      const raceListFiltered =
        targetMode === "class" && targetClassNorm
          ? raceList.filter((r) => normalizeLiveRcDriverNameForMatch(r.raceClass ?? "") === targetClassNorm)
          : raceList;
      if (isResultsIndexPage && targetMode === "class" && !targetClassNorm) {
        await prisma.watchedLapSource.update({ where: { id: s.id }, data: { lastCheckedAt: now } });
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "error",
          error: "Results sources require a target class.",
          parserId: null,
        });
        logWatch(runId, "final_decision", { sourceId: s.id, branch: "error", reason: "missing_target_class" });
        continue;
      }

      if (practiceListRaw.length === 0 && raceList.length === 0) {
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
        logWatch(runId, "final_decision", {
          sourceId: s.id,
          branch: "error",
          reason: "unsupported_or_empty_index",
          parsedRowCount: practiceListRaw.length,
          candidateSessionCount: 0,
        });
        continue;
      }

      // --- 2) Candidate session URLs (all practice + race rows; no target-driver prefilter) ---
      const discovered = [
        ...practiceListRaw.map((x) => ({
          kind: "practice" as const,
          driverName: x.driverName,
          sessionCompletedAtIso: x.sessionCompletedAtIso,
          sessionId: x.sessionId,
          sessionUrl: x.sessionUrl,
        })),
        ...raceListFiltered.map((x) => ({
          kind: "race" as const,
          driverName: null,
          sessionCompletedAtIso: x.sessionCompletedAtIso,
          sessionId: x.sessionId,
          sessionUrl: x.sessionUrl,
        })),
      ];

      const candidateSessionCount = discovered.length;
      logWatch(runId, "candidate_sessions", {
        sourceId: s.id,
        candidateSessionCount,
        candidateUrlsSample: discovered.slice(0, 15).map((d) => ({ kind: d.kind, url: d.sessionUrl })),
      });

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

      const skippedAsKnownCount = Math.max(0, withTime.length - importTargets.length);
      logWatch(runId, "after_new_vs_known_filter", {
        sourceId: s.id,
        forceImport: params.forceImport === true,
        withTimeRowCount: withTime.length,
        remainingCandidatesCount: importTargets.length,
        skippedAsKnownCount,
        lastSeenSessionCompletedAt: lastSeen?.toISOString() ?? null,
      });

      if (importTargets.length === 0) {
        await prisma.watchedLapSource.update({ where: { id: s.id }, data: { lastCheckedAt: now } });
        const msg = params.forceImport
          ? "Force import enabled, but no sessions were discovered on this page."
          : "No new sessions detected.";
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "no_change",
          message: msg,
        });
        logWatch(runId, "final_decision", {
          sourceId: s.id,
          branch: "no_change",
          reason: params.forceImport ? "no_sessions_on_page" : "no_new_sessions_vs_lastSeen",
          parsedRowCount: practiceListRaw.length,
          candidateSessionCount,
          skippedAsKnownCount,
          matchedSessionCount: 0,
          normalizedTarget: targetNorm || null,
        });
        continue;
      }

      // Safety cap: avoid importing hundreds of old sessions by mistake (newest-first).
      const cappedTargets = importTargets.slice(0, 10);

      let maxSeen: Date | null = lastSeen ?? null;
      /** Practice imports that returned success from importOneTimingUrl */
      let practiceParsedSessionCount = 0;
      /** Practice imports where canonical displayDriverName matched target (only when target set) */
      let practiceMatchedSessionCount = 0;
      const canonicalSamples: Array<{ driverName: string; sessionCompletedAtIso: string | null; sourceUrl: string }> = [];

      for (const t of cappedTargets) {
        const contextDriverName =
          t.kind === "practice"
            ? undefined
            : targetMode === "class" && userLiveRcDriverName
              ? { driverName: userLiveRcDriverName }
              : undefined;
        const imported = await importOneTimingUrl(params.userId, t.sessionUrl, contextDriverName);
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
        if (!enriched) {
          out.push({
            sourceId: s.id,
            sourceUrl: s.sourceUrl,
            driverName: s.driverName ?? null,
            carId: s.carId ?? null,
            status: "error",
            error: "Imported lap session could not be loaded after import.",
            parserId: imported.parserId ?? null,
          });
          continue;
        }
        const displayIso = enriched.sessionCompletedAtIso;
        const importedWhen = displayIso ? new Date(displayIso) : null;

        const canonicalDriver = enriched.displayDriverName.trim();
        if (t.kind === "practice") {
          practiceParsedSessionCount++;
          canonicalSamples.push({
            driverName: canonicalDriver,
            sessionCompletedAtIso: enriched.sessionCompletedAtIso,
            sourceUrl: enriched.timingSourceUrl,
          });
        }

        logWatch(runId, "canonical_import_sample", {
          sourceId: s.id,
          kind: t.kind,
          sessionUrl: t.sessionUrl,
          canonicalDriverName: canonicalDriver,
          sessionCompletedAtIso: displayIso,
          listRowDriverHint: t.kind === "practice" ? t.driverName : null,
        });

        // Practice + driver targeting: match canonical imported session driver, not list-row heuristics.
        if (targetMode === "driver" && isPracticeListPage && targetNorm && t.kind === "practice") {
          const canonNorm = normalizeLiveRcDriverNameForMatch(canonicalDriver);
          if (canonNorm !== targetNorm) {
            logWatch(runId, "driver_match_skip", {
              sourceId: s.id,
              reason: "canonical_driver_does_not_match_target",
              normalizedTarget: targetNorm,
              normalizedCanonicalDriver: canonNorm,
              canonicalDriverRaw: canonicalDriver,
              sessionUrl: t.sessionUrl,
            });
            continue;
          }
          practiceMatchedSessionCount++;
        }

        const shouldAdvanceLastSeen =
          t.kind === "race" ||
          !targetNorm ||
          t.kind !== "practice" ||
          normalizeLiveRcDriverNameForMatch(enriched.displayDriverName) === targetNorm;
        if (shouldAdvanceLastSeen && importedWhen && !Number.isNaN(importedWhen.getTime())) {
          maxSeen = maxDate(maxSeen, importedWhen);
        }

        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "new_imported",
          importedSessionId: imported.importedSessionId,
          importedFromUrl: enriched.timingSourceUrl ?? t.sessionUrl,
          sessionId: t.sessionId,
          sessionCompletedAtIso: displayIso,
          parserId: imported.parserId,
          message: imported.message ?? null,
          displayDriverName: enriched.displayDriverName || t.driverName || s.driverName || "Session",
          lapCount: enriched.lapCount ?? (Array.isArray(imported.laps) ? imported.laps.length : null),
          bestLapSeconds:
            enriched.bestLapSeconds ??
            (Array.isArray(imported.laps) && imported.laps.length > 0
              ? Math.min(...imported.laps.filter((n): n is number => typeof n === "number" && Number.isFinite(n)))
              : null),
        });
      }

      logWatch(runId, "driver_matching_stage", {
        sourceId: s.id,
        normalizedTargetDriverName: targetNorm || null,
        normalizedCandidateDriverNamesFromCanonicalImport: canonicalSamples.map((x) =>
          normalizeLiveRcDriverNameForMatch(x.driverName)
        ),
        rawCanonicalDriverNamesFromImport: canonicalSamples.map((x) => x.driverName),
        matchedSessionCount: practiceMatchedSessionCount,
        listRowHintNamesNormalized: practiceListRaw.map((x) => normalizeLiveRcDriverNameForMatch(x.driverName)),
      });

      logWatch(runId, "canonical_parse_batch_summary", {
        sourceId: s.id,
        parsedSessionCount: practiceParsedSessionCount,
        matchedSessionCount: practiceMatchedSessionCount,
        canonicalSamples: canonicalSamples.slice(0, 8),
        normalizedTarget: targetNorm || null,
        allListRowDriverNamesRaw: practiceListRaw.map((x) => x.driverName),
        allListRowDriverNamesNormalized: practiceListRaw.map((x) => normalizeLiveRcDriverNameForMatch(x.driverName)),
      });

      // Practice + target driver: imports succeeded but none matched canonical driver — not "no rows on list".
      if (
        targetMode === "driver" &&
        isPracticeListPage &&
        targetNorm &&
        importTargets.length > 0 &&
        practiceParsedSessionCount > 0 &&
        practiceMatchedSessionCount === 0
      ) {
        const allNamesNorm = practiceListRaw.map((x) => normalizeLiveRcDriverNameForMatch(x.driverName));
        const allNamesRaw = practiceListRaw.map((x) => x.driverName);
        logWatch(runId, "no_driver_match_mandatory_dump", {
          sourceId: s.id,
          parsedRowCount: practiceListRaw.length,
          candidateSessionCount,
          parsedSessionCount: practiceParsedSessionCount,
          matchedSessionCount: practiceMatchedSessionCount,
          normalizedTargetDriverName: targetNorm,
          allCandidateDriverNamesRaw: allNamesRaw,
          allCandidateDriverNamesNormalized: allNamesNorm,
          uniqueNormalizedListRowNames: [...new Set(allNamesNorm)],
          skippedDueToAlreadyKnownVsLastSeen: skippedAsKnownCount,
          filteringBeforeParse: "none (all list rows are import candidates)",
          filteringAfterParse:
            "sessions skipped when canonical displayDriverName (after import) !== normalized target",
          canonicalDriversSeenThisRun: canonicalSamples.map((c) => ({
            raw: c.driverName,
            normalized: normalizeLiveRcDriverNameForMatch(c.driverName),
          })),
        });
        const msg = `Imported ${practiceParsedSessionCount} practice session(s); none matched target driver "${targetDriverTrim}" by canonical name (parsed sessions). List-row names (normalized): ${[...new Set(allNamesNorm)].join(", ") || "—"}`;
        out.push({
          sourceId: s.id,
          sourceUrl: s.sourceUrl,
          driverName: s.driverName ?? null,
          carId: s.carId ?? null,
          status: "no_driver_match",
          message: msg,
          parsedCandidateCount: practiceListRaw.length,
          candidateDriverNamesSample: practiceListRaw.map((x) => x.driverName).slice(0, 40),
        });
        logWatch(runId, "final_decision", {
          sourceId: s.id,
          branch: "no_driver_match",
          reason: "canonical_practice_sessions_did_not_match_target_after_import",
          parsedRowCount: practiceListRaw.length,
          candidateSessionCount,
          parsedSessionCount: practiceParsedSessionCount,
          matchedSessionCount: practiceMatchedSessionCount,
          normalizedTarget: targetNorm,
          allCandidateDriverNamesNormalized: [...new Set(allNamesNorm)],
          allCandidateDriverNamesRaw: practiceListRaw.map((x) => x.driverName),
          skippedAsKnownBeforeImport: skippedAsKnownCount,
          note: "Matching uses canonical driver from ImportedLapTimeSession payload after import, not list-row text.",
        });
      } else {
        logWatch(runId, "final_decision", {
          sourceId: s.id,
          branch:
            practiceMatchedSessionCount > 0
              ? "matches_new_imported"
              : practiceParsedSessionCount === 0 && cappedTargets.length > 0
                ? "imports_completed_no_practice_rows_or_all_errors"
                : "completed_without_no_driver_match_row",
          parsedRowCount: practiceListRaw.length,
          candidateSessionCount,
          parsedSessionCount: practiceParsedSessionCount,
          matchedSessionCount: practiceMatchedSessionCount,
          normalizedTarget: targetNorm || null,
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
  logWatch(runId, "run_end", { resultRowCount: out.length });
  return out;
}
