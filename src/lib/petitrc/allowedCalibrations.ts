import { prisma } from "@/lib/prisma";

/**
 * Names of calibrations considered valid for PetitRC auto-pick. Only calibrations matching one of
 * these names (and having a linked example PDF) are used as candidates for exact-fingerprint matching.
 * Keep in sync with any UI that references the allowed set.
 */
export const ALLOWED_CALIBRATION_NAMES = [
  "A800RR-Old_V1.0",
  "A800RR_New_V1.0",
  "A800R Old_V1.1",
] as const;

/**
 * Resolve the current calibration ids for the allowed names (per user). When multiple rows share a
 * name, the most recently created one is returned (same dedupe rule as the PetitRC import picker).
 */
export async function resolveAllowedCalibrationIds(userId: string): Promise<string[]> {
  const rows = await prisma.setupSheetCalibration.findMany({
    where: { userId, name: { in: [...ALLOWED_CALIBRATION_NAMES] } },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const bestByName = new Map<string, string>();
  for (const r of rows) {
    if (!bestByName.has(r.name)) bestByName.set(r.name, r.id);
  }
  return [...bestByName.values()];
}
