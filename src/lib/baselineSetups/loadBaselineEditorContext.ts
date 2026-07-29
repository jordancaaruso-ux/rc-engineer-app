import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeSetupData } from "@/lib/runSetup";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { buildSetupSheetTemplateFromParsedSchema } from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import {
  sortBaselineSetups,
  type BaselineSetupKindValue,
} from "@/lib/baselineSetups/baselineSetupShape";
import type { BaselineStartOption } from "@/components/baselineSetups/BaselineSetupEditorClient";

/**
 * Everything both baseline editor pages need: the chassis, its sheet template, and the other
 * baselines offered as starting points. Chassis models are global — never scoped by userId.
 *
 * `template` is null when the chassis has no parameter schema yet; the page renders "build the
 * sheet first" rather than an empty form.
 */
export async function loadBaselineEditorContext(
  modelId: string,
  options?: { excludeBaselineId?: string }
): Promise<{
  model: { id: string; name: string };
  template: SetupSheetTemplate | null;
  startOptions: BaselineStartOption[];
} | null> {
  const model = await prisma.setupSheetModel.findUnique({
    where: { id: modelId },
    select: { id: true, name: true, schemaJson: true },
  });
  if (!model) return null;

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  const template = schema
    ? buildSetupSheetTemplateFromParsedSchema(model.id, model.name, schema, "setup")
    : null;

  const rows = await prisma.baselineSetup.findMany({
    where: {
      setupSheetModelId: model.id,
      ...(options?.excludeBaselineId ? { id: { not: options.excludeBaselineId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, kind: true, data: true },
  });

  return {
    model: { id: model.id, name: model.name },
    template,
    startOptions: sortBaselineSetups(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind as BaselineSetupKindValue,
        data: normalizeSetupData(r.data),
      }))
    ),
  };
}
