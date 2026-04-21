import "server-only";

import { prisma } from "@/lib/prisma";

export type EffectiveCalibrationResult = {
  calibrationId: string | null;
  source: "explicit" | "stored" | "soft_default" | "none";
  debug: string;
};

/**
 * Single source of truth for which calibration id is used.
 * Selection order:
 * 1) explicit id (if provided and exists for user)
 * 2) stored id (if provided and exists for user)
 * 3) soft default id (if provided and exists for user)
 * 4) none (null) — never throws for missing defaults.
 */
export async function getEffectiveCalibrationProfileId(input: {
  userId: string;
  explicitCalibrationId?: string | null;
  storedCalibrationId?: string | null;
  softDefaultCalibrationId?: string | null;
  context: string;
}): Promise<EffectiveCalibrationResult> {
  const explicit =
    typeof input.explicitCalibrationId === "string" && input.explicitCalibrationId.trim()
      ? input.explicitCalibrationId.trim()
      : null;
  const stored =
    typeof input.storedCalibrationId === "string" && input.storedCalibrationId.trim()
      ? input.storedCalibrationId.trim()
      : null;
  const softDefault =
    typeof input.softDefaultCalibrationId === "string" && input.softDefaultCalibrationId.trim()
      ? input.softDefaultCalibrationId.trim()
      : null;

  const candidates: Array<{ id: string; source: EffectiveCalibrationResult["source"] }> = [];
  if (explicit) candidates.push({ id: explicit, source: "explicit" });
  if (stored) candidates.push({ id: stored, source: "stored" });
  if (softDefault) candidates.push({ id: softDefault, source: "soft_default" });

  for (const candidate of candidates) {
    const exists = await prisma.setupSheetCalibration.findFirst({
      where: {
        id: candidate.id,
        OR: [{ userId: input.userId }, { communityShared: true }],
      },
      select: { id: true },
    });
    if (exists) {
      return {
        calibrationId: candidate.id,
        source: candidate.source,
        debug: `${input.context}: ${candidate.source}=${candidate.id}`,
      };
    }
  }

  const attempted = candidates.map((c) => `${c.source}=${c.id}`).join(", ");
  return {
    calibrationId: null,
    source: "none",
    debug: `${input.context}: no calibration selected${attempted ? ` (attempted ${attempted})` : ""}`,
  };
}

/** Reads sticky SetupDocument calibrationProfileId and resolves effective (nullable) calibration. */
export async function ensureSetupDocumentCalibrationProfileId(input: {
  userId: string;
  setupDocumentId: string;
}): Promise<EffectiveCalibrationResult> {
  const doc = await prisma.setupDocument.findFirst({
    where: { id: input.setupDocumentId, userId: input.userId },
    select: { id: true, calibrationProfileId: true },
  });
  if (!doc) throw new Error("Setup document not found");
  const effective = await getEffectiveCalibrationProfileId({
    userId: input.userId,
    storedCalibrationId: doc.calibrationProfileId,
    context: `setupDocument:${doc.id}`,
  });
  console.log(
    `[calibration/effective] doc=${doc.id} stored=${doc.calibrationProfileId ?? "null"} effective=${effective.calibrationId ?? "null"} source=${effective.source}`
  );
  return effective;
}

