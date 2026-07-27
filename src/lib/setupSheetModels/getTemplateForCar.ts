import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getDefaultSetupSheetTemplate, type SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import {
  buildSetupSheetTemplateFromParsedSchema,
  type SetupSheetTemplateView,
} from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import { resolveSetupSheetModelForCar } from "@/lib/setupSheetModels/resolveModelForCar";
import {
  SETUP_SHEET_TEMPLATE_A800RR,
  canonicalSetupSheetTemplateId,
  isA800RRCar,
  templateKeyFromModelSlug,
} from "@/lib/setupSheetTemplateId";

export async function getSetupSheetTemplateForCar(
  userId: string,
  car: { setupSheetModelId: string | null; setupSheetTemplate: string | null },
  view: SetupSheetTemplateView = "setup"
): Promise<SetupSheetTemplate> {
  const { template } = await getSetupSheetTemplateAndKeyForCar(userId, car, view);
  return template;
}

/**
 * Sheet template plus the community-aggregation bucket key (model slug, or the legacy template
 * string for unlinked cars). `templateKey` is null when the car has neither — callers must skip
 * community lookups rather than fall back to another chassis' data.
 */
export async function getSetupSheetTemplateAndKeyForCar(
  userId: string,
  car: { setupSheetModelId: string | null; setupSheetTemplate: string | null },
  view: SetupSheetTemplateView = "setup"
): Promise<{ template: SetupSheetTemplate; templateKey: string | null }> {
  const model = await resolveSetupSheetModelForCar(userId, car);
  if (model) {
    const templateKey = templateKeyFromModelSlug(model.slug);
    return {
      template: buildSetupSheetTemplateFromParsedSchema(
        model.id,
        model.name,
        model.schema,
        view,
        templateKey
      ),
      templateKey,
    };
  }
  if (isA800RRCar(car.setupSheetTemplate)) {
    return { template: A800RR_SETUP_SHEET_V1, templateKey: SETUP_SHEET_TEMPLATE_A800RR };
  }
  return {
    template: getDefaultSetupSheetTemplate(),
    templateKey: canonicalSetupSheetTemplateId(car.setupSheetTemplate),
  };
}
