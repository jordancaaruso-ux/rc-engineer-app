import { prisma } from "@/lib/prisma";
import { parseTimingUrl } from "@/lib/lapUrlParsers/registry";
import { validateTimingHttpUrlResolved } from "@/lib/lapImport/service";
import { driversFromParseResult, driversFromRunImportedLapSets } from "./timing";
import type { ManualDriver } from "./types";

export async function loadDriversFromRun(
  runId: string,
  userId: string
): Promise<ManualDriver[] | null> {
  const run = await prisma.run.findFirst({
    where: { id: runId, userId },
    include: {
      importedLapSets: {
        include: { laps: { where: { isIncluded: true }, orderBy: { lapNumber: "asc" } } },
      },
    },
  });
  if (!run?.importedLapSets.length) return null;
  return driversFromRunImportedLapSets(run.importedLapSets);
}

export async function loadDriversFromTimingUrl(
  url: string,
  primaryDriverName?: string | null,
  options?: { allowAnyPublicHost?: boolean }
): Promise<{ drivers: ManualDriver[]; parserId: string } | { error: string }> {
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
    drivers: driversFromParseResult(parsed, primaryDriverName),
    parserId: parsed.parserId,
  };
}
