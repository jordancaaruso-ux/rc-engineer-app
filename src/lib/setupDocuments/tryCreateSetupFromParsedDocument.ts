import "server-only";

import { prisma } from "@/lib/prisma";
import { isCarValidTargetForSetupDocument } from "@/lib/carSetupScope";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";

export type TryCreateSetupResult =
  | { ok: true; setupId: string }
  | { ok: false; reason: string };

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
    },
  });
  if (!doc) return { ok: false, reason: "not_found" };
  if (doc.createdSetupId) return { ok: false, reason: "already_linked" };
  if (doc.parseStatus !== "PARSED" && doc.parseStatus !== "PARTIAL") {
    return { ok: false, reason: "parse_not_ready" };
  }
  if (!doc.carId) return { ok: false, reason: "no_car" };

  const allowed = await isCarValidTargetForSetupDocument(input.userId, doc, doc.carId);
  if (!allowed) return { ok: false, reason: "car_mismatch" };

  try {
    const setup = await prisma.setupSnapshot.create({
      data: {
        userId: input.userId,
        carId: doc.carId,
        data: normalizeSetupSnapshotForStorage((doc.parsedDataJson ?? {}) as SetupSnapshotData) as object,
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
