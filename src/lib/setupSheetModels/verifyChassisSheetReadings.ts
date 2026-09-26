import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Approving a chassis approves its sheet readings in the same tap (founder ruling 2026-09-26).
 *
 * A driver's upload makes two rows that each wanted the founder: the chassis (`isAuthorized`, which
 * lets it into the community numbers) and the calibration that reads the PDF's boxes (`verifiedAt`,
 * which lets OTHER drivers' copies of that sheet be read with it — see
 * `calibrationsAutoPickableByUserWhere`). They sat in the review queue as two separate rows for one
 * decision. Now the chassis is the decision.
 *
 * "Its sheet readings" is exact: the calibrations drawn from this chassis's own uploaded sheets —
 * found through the upload's document, which is each one's example document — plus its default.
 * A calibration some driver drew by hand for the chassis is not one of them: it stays their own
 * until the founder verifies it on the calibrations page, because a wrong hand mapping mis-reads
 * everyone's setups, which is what the flag is for. These are read off the PDF's own form layer,
 * box by box, so they cannot be wrong in that way.
 *
 * Only ever verifies. Un-approving a chassis leaves its readings alone: they still read that PDF
 * correctly, and they may have been trusted for reasons of their own. Never throws.
 */
export async function verifyChassisSheetReadings(modelId: string): Promise<number> {
  try {
    const [model, blanks] = await Promise.all([
      prisma.setupSheetModel.findUnique({
        where: { id: modelId },
        select: { defaultCalibrationId: true },
      }),
      prisma.setupSheetBlank.findMany({
        where: { setupSheetModelId: modelId, setupDocumentId: { not: null } },
        select: { setupDocumentId: true },
      }),
    ]);
    const documentIds = blanks.map((b) => b.setupDocumentId).filter((id): id is string => !!id);
    const readings = [
      ...(documentIds.length > 0 ? [{ exampleDocumentId: { in: documentIds } }] : []),
      ...(model?.defaultCalibrationId ? [{ id: model.defaultCalibrationId }] : []),
    ];
    if (readings.length === 0) return 0;
    const res = await prisma.setupSheetCalibration.updateMany({
      where: { setupSheetModelId: modelId, verifiedAt: null, OR: readings },
      data: { verifiedAt: new Date() },
    });
    return res.count;
  } catch (error) {
    console.error("[chassis-approve] sheet readings not verified", modelId, error);
    return 0;
  }
}
