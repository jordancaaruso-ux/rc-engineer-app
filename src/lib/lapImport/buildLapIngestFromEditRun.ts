import type { LapRow } from "@/lib/lapAnalysis";
import { primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { normalizeLapTimes } from "@/lib/runLaps";
import { tryParseLapSessionV1 } from "@/lib/lapSession/buildSession";
import type { LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import {
  primaryLapRowsFromImportedPayload,
  sessionCompletedAtIsoFromImportedPayload,
} from "@/lib/lapImport/fromPayload";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
import type { LapIngestFormValue, UrlImportBlock } from "@/components/runs/LapTimesIngestPanel";

function defaultLapIngestValue(): LapIngestFormValue {
  return {
    manualText: "",
    manualLapRows: null,
    sourceKind: "manual",
    sourceDetail: null,
    parserId: null,
    urlLapRows: null,
    urlImportBlocks: [],
  };
}

export type EditRunImportedLapSet = {
  driverName: string;
  displayName: string | null;
  isPrimaryUser: boolean;
  sourceUrl?: string | null;
  driverId?: string | null;
  sessionCompletedAt?: string | null;
  laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>;
};

export type EditRunLinkedImportedSession = {
  id: string;
  sourceUrl: string;
  parserId: string;
  createdAt: string;
  sessionCompletedAt: string | null;
  parsedPayload: unknown;
};

function lapRowsFromNums(nums: number[]): LapRow[] {
  return applyMedianBandAutoExclude(
    nums.map((t, i) => ({
      lapNumber: i + 1,
      lapTimeSeconds: t,
      isIncluded: true,
    }))
  );
}

function lapRowsFromImportedSet(
  laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }>
): LapRow[] {
  return laps.map((l) => ({
    lapNumber: l.lapNumber,
    lapTimeSeconds: l.lapTimeSeconds,
    isIncluded: l.isIncluded,
  }));
}

function matchDriverToSet(
  driver: LapUrlSessionDriver,
  sets: EditRunImportedLapSet[]
): EditRunImportedLapSet | undefined {
  return (
    sets.find((s) => s.driverId?.trim() && s.driverId.trim() === driver.driverId) ??
    sets.find((s) => s.driverName.trim() === driver.driverName.trim()) ??
    sets.find((s) => s.isPrimaryUser)
  );
}

function driverLapRowsForBlock(
  sessionDrivers: LapUrlSessionDriver[],
  sets: EditRunImportedLapSet[]
): Record<string, LapRow[]> {
  const out: Record<string, LapRow[]> = {};
  for (const driver of sessionDrivers) {
    const set = matchDriverToSet(driver, sets);
    if (set?.laps.length) {
      out[driver.driverId] = lapRowsFromImportedSet(set.laps);
    } else {
      out[driver.driverId] = lapRowsFromNums(driver.laps);
    }
  }
  return out;
}

function selectedDriverIdsForBlock(
  sessionDrivers: LapUrlSessionDriver[],
  sets: EditRunImportedLapSet[]
): string[] {
  const primarySet = sets.find((s) => s.isPrimaryUser) ?? sets[0];
  if (primarySet) {
    const match =
      sessionDrivers.find((d) => primarySet.driverId?.trim() && d.driverId === primarySet.driverId.trim()) ??
      sessionDrivers.find((d) => d.driverName.trim() === primarySet.driverName.trim());
    if (match) return [match.driverId];
  }
  if (sessionDrivers.length === 1 && sessionDrivers[0]?.driverId) {
    return [sessionDrivers[0].driverId];
  }
  return sessionDrivers[0]?.driverId ? [sessionDrivers[0].driverId] : [];
}

function primaryLapTextFromBlocks(blocks: UrlImportBlock[]): string {
  const first = blocks[0];
  if (!first?.sessionDrivers?.length) return "";
  const pid = first.selectedDriverIds?.[0] ?? first.sessionDrivers[0]?.driverId;
  if (!pid) return "";
  const rows = first.driverLapRowsByDriverId?.[pid];
  if (rows?.length) {
    return rows.map((r) => r.lapTimeSeconds.toFixed(3)).join("\n");
  }
  const driver = first.sessionDrivers.find((d) => d.driverId === pid);
  return driver?.laps.map((t) => t.toFixed(3)).join("\n") ?? "";
}

function blockFromLinkedSession(
  sess: EditRunLinkedImportedSession,
  importedLapSets: EditRunImportedLapSet[]
): UrlImportBlock | null {
  const setsForUrl = importedLapSets.filter(
    (s) => (s.sourceUrl?.trim() ?? "") === sess.sourceUrl.trim()
  );
  const sessionDrivers = rawSessionDriversFromImportedPayload(sess.parsedPayload) ?? [];
  if (sessionDrivers.length === 0) {
    const parsed = primaryLapRowsFromImportedPayload(sess.parsedPayload);
    if (!parsed) return null;
    const driverId = "restored-primary";
    return {
      blockId: `restored-${sess.id}`,
      importedSessionId: sess.id,
      sourceUrl: sess.sourceUrl,
      parserId: sess.parserId,
      recordedAt: sess.createdAt,
      sessionCompletedAtDbIso: sess.sessionCompletedAt,
      sessionCompletedAtIso: sessionCompletedAtIsoFromImportedPayload(sess.parsedPayload),
      sessionDrivers: [
        {
          id: driverId,
          driverId,
          driverName: parsed.driverName,
          normalizedName: parsed.driverName.toLowerCase(),
          laps: parsed.rows.map((r) => r.lapTimeSeconds),
          lapCount: parsed.rows.length,
        },
      ],
      selectedDriverIds: [driverId],
      driverLapRowsByDriverId: {
        [driverId]: parsed.rows.map((r) => ({ ...r })),
      },
      urlLapRows: null,
    };
  }

  const sets = setsForUrl.length > 0 ? setsForUrl : importedLapSets;
  return {
    blockId: `restored-${sess.id}`,
    importedSessionId: sess.id,
    sourceUrl: sess.sourceUrl,
    parserId: sess.parserId,
    recordedAt: sess.createdAt,
    sessionCompletedAtDbIso: sess.sessionCompletedAt,
    sessionCompletedAtIso: sessionCompletedAtIsoFromImportedPayload(sess.parsedPayload),
    sessionDrivers,
    selectedDriverIds: selectedDriverIdsForBlock(sessionDrivers, sets),
    driverLapRowsByDriverId: driverLapRowsForBlock(sessionDrivers, sets),
    urlLapRows: null,
  };
}

function dedupeLinkedSessions(sessions: EditRunLinkedImportedSession[]): EditRunLinkedImportedSession[] {
  const byUrl = new Map<string, EditRunLinkedImportedSession>();
  for (const sess of sessions) {
    const key = sess.sourceUrl.trim();
    if (!key) continue;
    if (!byUrl.has(key)) byUrl.set(key, sess);
  }
  return [...byUrl.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Rehydrate URL-import lap ingest state when editing a saved or draft run.
 */
export function buildLapIngestFromEditRun(input: {
  lapTimes: unknown;
  lapSession: unknown;
  importedLapSets?: EditRunImportedLapSet[];
  linkedImportedSessions?: EditRunLinkedImportedSession[];
}): LapIngestFormValue {
  const base = defaultLapIngestValue();
  const existingLapRows = primaryLapRowsFromRun({
    lapTimes: input.lapTimes ?? [],
    lapSession: input.lapSession,
  });
  const existingLaps = normalizeLapTimes(input.lapTimes ?? []);
  const existingText = existingLaps.length ? existingLaps.map((n) => n.toFixed(3)).join("\n") : "";
  const importedLapSets = input.importedLapSets ?? [];
  const linkedSessions = dedupeLinkedSessions(input.linkedImportedSessions ?? []);

  const blocks: UrlImportBlock[] = [];
  for (const sess of linkedSessions) {
    const block = blockFromLinkedSession(sess, importedLapSets);
    if (block) blocks.push(block);
  }

  if (blocks.length > 0) {
    return {
      ...base,
      manualText: primaryLapTextFromBlocks(blocks) || existingText,
      manualLapRows: existingLapRows.length ? existingLapRows : null,
      sourceKind: "url",
      sourceDetail:
        blocks.length === 1 ? blocks[0]!.sourceUrl : `${blocks.length} timing URLs`,
      parserId: blocks[0]?.parserId ?? null,
      urlLapRows: null,
      urlImportBlocks: blocks,
    };
  }

  const parsedSession = tryParseLapSessionV1(input.lapSession);
  if (parsedSession?.source.kind === "url" && importedLapSets.length > 0) {
    const sourceUrl = parsedSession.source.detail?.trim() ?? "";
    const sets = sourceUrl
      ? importedLapSets.filter((s) => (s.sourceUrl?.trim() ?? "") === sourceUrl)
      : importedLapSets;
    const primarySet = sets.find((s) => s.isPrimaryUser) ?? sets[0];
    if (primarySet) {
      const driverId = primarySet.driverId?.trim() || "restored-primary";
      const laps = primarySet.laps.map((l) => l.lapTimeSeconds);
      const rows = lapRowsFromImportedSet(primarySet.laps);
      return {
        ...base,
        manualText: existingText || laps.map((n) => n.toFixed(3)).join("\n"),
        manualLapRows: existingLapRows.length ? existingLapRows : rows,
        sourceKind: "url",
        sourceDetail: sourceUrl || "Imported timing session",
        parserId: parsedSession.source.parserId ?? null,
        urlLapRows: null,
        urlImportBlocks: [
          {
            blockId: "restored-legacy",
            importedSessionId: "",
            sourceUrl: sourceUrl || "imported-session",
            parserId: parsedSession.source.parserId ?? "http_timing_v1",
            recordedAt: new Date().toISOString(),
            sessionCompletedAtDbIso: primarySet.sessionCompletedAt ?? null,
            sessionCompletedAtIso: primarySet.sessionCompletedAt ?? null,
            sessionDrivers: [
              {
                id: driverId,
                driverId,
                driverName: primarySet.displayName?.trim() || primarySet.driverName,
                normalizedName: primarySet.driverName.toLowerCase(),
                laps,
                lapCount: laps.length,
              },
            ],
            selectedDriverIds: [driverId],
            driverLapRowsByDriverId: { [driverId]: rows },
            urlLapRows: null,
          },
        ],
      };
    }
  }

  return {
    ...base,
    manualText: existingText,
    manualLapRows: existingLapRows.length ? existingLapRows : null,
    sourceKind: existingText ? "manual" : "manual",
    sourceDetail: parsedSession ? "Existing laps loaded (edit)" : null,
    parserId: parsedSession?.source.parserId ?? null,
    urlLapRows: null,
    urlImportBlocks: [],
  };
}
