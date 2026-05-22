import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getDefaultSetupSheetTemplate, type SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { buildSetupSheetTemplateFromParsedSchema } from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import { resolveSetupSheetModelForCar } from "@/lib/setupSheetModels/resolveModelForCar";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";

export async function getSetupSheetTemplateForCar(
  userId: string,
  car: { setupSheetModelId: string | null; setupSheetTemplate: string | null }
): Promise<SetupSheetTemplate> {
  const model = await resolveSetupSheetModelForCar(userId, car);
  if (model) {
    const built = buildSetupSheetTemplateFromParsedSchema(model.id, model.name, model.schema);
    return built;
  }
  if (isA800RRCar(car.setupSheetTemplate)) {
    return A800RR_SETUP_SHEET_V1;
  }
  return getDefaultSetupSheetTemplate();
}
