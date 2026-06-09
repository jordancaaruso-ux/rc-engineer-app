import { prisma } from "@/lib/prisma";
import { parseTimingUrl } from "@/lib/lapUrlParsers/registry";
import { validateTimingHttpUrlResolved } from "@/lib/lapImport/service";
import {
  driversFromParseResult,
  driversFromRunImportedLapSets,
  timingSessionFromParseResult,
  timingSessionsFromRunImportedLapSets,
} from "./timing";
import type { ManualDriver, ManualTimingSession } from "./types";

export async function loadTimingSessionsFromRun(
  runId: string,
  userId: string
): Promise<ManualTimingSession[] | null> {
  const run = await prisma.run.findFirst({
    where: { id: runId, userId },
    include: {
      importedLapSets: {
        include: { laps: { where: { isIncluded: true }, orderBy: { lapNumber: "asc" } } },
      },
    },
  });
  if (!run?.importedLapSets.length) return null;
  return timingSessionsFromRunImportedLapSets(run.importedLapSets);
}

/** @deprecated use loadTimingSessionsFromRun */
export async function loadDriversFromRun(
  runId: string,
  userId: string
): Promise<ManualDriver[] | null> {
  const sessions = await loadTimingSessionsFromRun(runId, userId);
  if (!sessions?.length) return null;
  return sessions[0]!.drivers;
}

export async function loadTimingSessionFromUrl(
  url: string,
  primaryDriverName?: string | null,
  options?: { allowAnyPublicHost?: boolean }
): Promise<{ session: ManualTimingSession; parserId: string } | { error: string }> {
  const v = await validateTimingHttpUrlResolved(url, {
    allowAnyPublicHost: options?.allowAnyPublicHost,
  });
  if (!v.ok) return { error: v.error };
  const parsed = await parseTimingUrl(v.normalized, {
    driverName: primaryDriverName ?? undefined,
  });
  const sd = parsed.sessionDrivers ?? [];
  if (sd.length === 0 && parsed.laps.length === 0) {
    return { error: parsed.message ?? "No laps found at URL" };
  }
  return {
    session: timingSessionFromParseResult(parsed, v.normalized, primaryDriverName),
    parserId: parsed.parserId,
  };
}

/** @deprecated use loadTimingSessionFromUrl */
export async function loadDriversFromTimingUrl(
  url: string,
  primaryDriverName?: string | null,
  options?: { allowAnyPublicHost?: boolean }
): Promise<{ drivers: ManualDriver[]; parserId: string } | { error: string }> {
  const result = await loadTimingSessionFromUrl(url, primaryDriverName, options);
  if ("error" in result) return result;
  return { drivers: result.session.drivers, parserId: result.parserId };
}
