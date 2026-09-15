import type { Prisma } from "@prisma/client";

/**
 * One driver's laps off a timing page, as the run save receives them.
 *
 * `laps` is either a bare number list (legacy clients) or structured rows carrying the
 * driver's own include/exclude ticks.
 */
export type ImportedLapSetInput = {
  sourceUrl?: string | null;
  driverId?: string | null;
  driverName?: string;
  normalizedName?: string;
  isPrimaryUser?: boolean;
  /** UTC ISO instant from timing page when known. */
  sessionCompletedAt?: string | null;
  /** True when `sessionCompletedAt` is on-track wall clock (LiveRC/MyRCM store as-if-UTC) vs import-time fallback. */
  sessionCompletedAtIsWallClock?: boolean;
  laps?: number[] | Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded?: boolean }>;
};

/**
 * Persist the field rows (`RunImportedLapSet` + `RunImportedLap`) for one run.
 *
 * Lifted out of `POST /api/runs` so a run the app creates on the driver's behalf (the lap step's
 * "Add N other runs from today") writes its field exactly the way a hand-logged run does. Caller
 * clears any existing sets first when replacing.
 */
export async function writeRunImportedLapSets(
  db: Pick<Prisma.TransactionClient, "runImportedLapSet" | "runImportedLap">,
  runId: string,
  importedLapSets: readonly ImportedLapSetInput[]
): Promise<void> {
  for (const set of importedLapSets) {
    const driverName = typeof set.driverName === "string" ? set.driverName.trim() : "";
    if (!driverName) continue;
    const rawLaps = Array.isArray(set.laps) ? set.laps : [];
    const lapsForSet: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }> = [];
    if (rawLaps.length > 0 && typeof rawLaps[0] === "number") {
      const nums = rawLaps.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
      for (let i = 0; i < nums.length; i++) {
        lapsForSet.push({ lapNumber: i + 1, lapTimeSeconds: nums[i]!, isIncluded: true });
      }
    } else {
      for (const row of rawLaps) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const lapNumber =
          typeof r.lapNumber === "number" && Number.isFinite(r.lapNumber) ? Math.floor(r.lapNumber) : 0;
        const lapTimeSeconds =
          typeof r.lapTimeSeconds === "number" && Number.isFinite(r.lapTimeSeconds) ? r.lapTimeSeconds : NaN;
        if (!Number.isFinite(lapTimeSeconds)) continue;
        lapsForSet.push({
          lapNumber,
          lapTimeSeconds,
          isIncluded: r.isIncluded !== false,
        });
      }
    }
    if (lapsForSet.length === 0) continue;
    const normalizedName =
      typeof set.normalizedName === "string" && set.normalizedName.trim()
        ? set.normalizedName.trim().toLowerCase()
        : driverName.toLowerCase();
    let sessionCompletedAt: Date | null = null;
    if (typeof set.sessionCompletedAt === "string" && set.sessionCompletedAt.trim()) {
      const d = new Date(set.sessionCompletedAt.trim());
      if (!Number.isNaN(d.getTime())) sessionCompletedAt = d;
    }
    const createdSet = await db.runImportedLapSet.create({
      data: {
        runId,
        sourceUrl: typeof set.sourceUrl === "string" && set.sourceUrl.trim() ? set.sourceUrl.trim() : null,
        driverId: typeof set.driverId === "string" && set.driverId.trim() ? set.driverId.trim() : null,
        driverName,
        normalizedName,
        isPrimaryUser: Boolean(set.isPrimaryUser),
        sessionCompletedAt,
      },
      select: { id: true },
    });
    await db.runImportedLap.createMany({
      data: lapsForSet.map((row) => ({
        lapSetId: createdSet.id,
        lapNumber: row.lapNumber,
        lapTimeSeconds: row.lapTimeSeconds,
        isIncluded: row.isIncluded,
      })),
    });
  }
}
