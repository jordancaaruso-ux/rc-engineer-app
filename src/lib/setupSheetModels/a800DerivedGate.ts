import "server-only";

import { prisma } from "@/lib/prisma";
import { SETUP_SHEET_MODEL_SLUG_A800RR, isA800RRCar } from "@/lib/setupSheetTemplateId";

/** Whether A800RR spring lookup derived fields should run for this document. */
export async function documentUsesA800rrDerived(input: {
  userId: string;
  setupSheetModelId?: string | null;
  setupSheetTemplate?: string | null;
}): Promise<boolean> {
  if (input.setupSheetModelId) {
    const model = await prisma.setupSheetModel.findFirst({
      where: { id: input.setupSheetModelId, userId: input.userId },
      select: { slug: true },
    });
    return model?.slug === SETUP_SHEET_MODEL_SLUG_A800RR;
  }
  return isA800RRCar(input.setupSheetTemplate);
}
