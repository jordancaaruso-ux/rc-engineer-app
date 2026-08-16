import "server-only";

import { prisma } from "@/lib/prisma";
import { isCarValidTargetForSetupDocument } from "@/lib/carSetupScope";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";
import {
  isUnrecognisedSheet,
  unrecognisedSheetMessage,
  type SheetNamePresence,
} from "@/lib/setupCalibrations/sheetRecognition";
import { linkTireFieldsInSnapshotData } from "@/lib/tires/linkTireFieldsInSnapshot";

export type TryCreateSetupResult =
  | { ok: true; setupId: string }
  | { ok: false; reason: string; driverMessage?: string };

/**
 * Read the name-presence measurement the extract pipeline stored on the document.
 *
 * Returns null for any document that never went through the calibrated PDF path (image reads, AI
 * reads, the chassis-disambiguation marker), so those are unaffected — the diagnostic column holds
 * several different shapes and only one of them carries this.
 */
function namePresenceFromDiagnostic(diagnostic: unknown): SheetNamePresence | null {
  if (!diagnostic || typeof diagnostic !== "object") return null;
  const mapping = (diagnostic as { mapping?: unknown }).mapping;
  if (!mapping || typeof mapping !== "object") return null;
  const presence = (mapping as { namePresence?: unknown }).namePresence;
  if (!presence || typeof presence !== "object") return null;
  const { referenced, present, ratio } = presence as Record<string, unknown>;
  if (typeof referenced !== "number" || typeof present !== "number" || typeof ratio !== "number") {
    return null;
  }
  return { referenced, present, ratio };
}

/**
 * Creates a {@link SetupSnapshot} from a document's `parsedDataJson` when parse is usable
 * and the document has no linked setup yet. Shared by quick-create and post-process hook.
 */
export async function tryCreateSetupFromParsedDocument(input: {
  docId: string;
  userId: string;
}): Promise<TryCreateSetupResult> {
  const doc = await prisma.setupDocument.findFirst({
    where: { id: input.docId, userId: input.userId },
    select: {
      id: true,
      parseStatus: true,
      parsedDataJson: true,
      carId: true,
      createdSetupId: true,
      setupSheetTemplate: true,
      importDiagnosticJson: true,
      calibrationResolvedProfileId: true,
    },
  });
  if (!doc) return { ok: false, reason: "not_found" };
  if (doc.createdSetupId) return { ok: false, reason: "already_linked" };
  if (doc.parseStatus !== "PARSED" && doc.parseStatus !== "PARTIAL") {
    return { ok: false, reason: "parse_not_ready" };
  }

  /*
   * The sheet is not the sheet this calibration was drawn for (2026-08-16).
   *
   * A setup created here becomes the driver's record of the car: runs point at it, the Engineer
   * reads it, "what changed since last run" is computed from it. Creating one from a read that
   * matched almost none of the sheet's boxes writes a wrong answer into all three, and it did:
   * one Pro driver logged 18 runs across a full test day against a six-field setup, because his
   * A800RR sheet was a rebuilt edition with every box renamed and nothing said so.
   *
   * Refusing leaves the document, the file and the render intact — only the SetupSnapshot is
   * withheld, so the review screen can offer the sheet as its own chassis (`derive=1`) and the
   * driver ends up with every box instead of six.
   */
  const presence = namePresenceFromDiagnostic(doc.importDiagnosticJson);
  if (presence && isUnrecognisedSheet(presence)) {
    let calibrationName: string | null = null;
    if (doc.calibrationResolvedProfileId) {
      const cal = await prisma.setupSheetCalibration.findUnique({
        where: { id: doc.calibrationResolvedProfileId },
        select: { name: true },
      });
      calibrationName = cal?.name ?? null;
    }
    console.log(
      `[setup-documents/unrecognised-sheet] doc=${doc.id} present=${presence.present}/${presence.referenced} ratio=${presence.ratio.toFixed(3)} calibration=${calibrationName ?? "none"}`
    );
    return {
      ok: false,
      reason: "unrecognised_sheet",
      driverMessage: unrecognisedSheetMessage({ presence, calibrationName }),
    };
  }

  if (doc.carId) {
    const allowed = await isCarValidTargetForSetupDocument(input.userId, doc, doc.carId);
    if (!allowed) return { ok: false, reason: "car_mismatch" };
  }

  try {
    const normalized = normalizeSetupSnapshotForStorage(
      (doc.parsedDataJson ?? {}) as SetupSnapshotData
    ) as SetupSnapshotData;
    const linkedTires = await linkTireFieldsInSnapshotData(normalized);
    const setup = await prisma.setupSnapshot.create({
      data: {
        userId: input.userId,
        carId: doc.carId,
        data: normalizeSetupSnapshotForStorage(linkedTires) as object,
      },
      select: { id: true },
    });
    const linked = await prisma.setupDocument.updateMany({
      where: { id: input.docId, userId: input.userId, createdSetupId: null },
      data: { createdSetupId: setup.id },
    });
    if (linked.count !== 1) {
      await prisma.setupSnapshot.delete({ where: { id: setup.id } }).catch(() => {});
      return { ok: false, reason: "race_or_concurrent_link" };
    }
    return { ok: true, setupId: setup.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}
