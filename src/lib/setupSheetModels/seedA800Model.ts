import "server-only";

import { prisma } from "@/lib/prisma";
import {
  SETUP_SHEET_MODEL_SLUG_A800RR,
  SETUP_SHEET_TEMPLATE_A800RR,
} from "@/lib/setupSheetTemplateId";
import { A800RR_STRUCTURED_SECTIONS } from "@/lib/a800rrSetupDisplayConfig";
import {
  buildCalibrationFieldCatalog,
  getCalibrationFieldKind,
} from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { materializeAwesomatixTemplateDefaultsOnField } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

export { SETUP_SHEET_MODEL_SLUG_A800RR } from "@/lib/setupSheetTemplateId";

/** Build schema from A800 catalog + structured sections (for migration seed). */
export function buildA800SeedSchema(): SetupSheetModelSchema {
  const catalog = buildCalibrationFieldCatalog();
  const fields: SetupSheetModelFieldDef[] = [];
  let order = 0;
  for (const meta of catalog) {
    if (meta.groupId === "document" || meta.groupId === "metadata") continue;
    const kind = getCalibrationFieldKind(meta.key);
    fields.push(
      materializeAwesomatixTemplateDefaultsOnField({
        key: meta.key,
        displayLabel: meta.label,
        sectionId: meta.groupId,
        sectionTitle: meta.groupTitle,
        valueType: kind === "number" ? "number" : kind === "boolean" ? "boolean" : "string",
        uiType:
          kind === "boolean"
            ? "checkbox"
            : kind === "singleSelect"
              ? "select"
              : kind === "visualMulti"
                ? "multiSelect"
                : "text",
        unit: meta.unit,
        showInSetupSheet: true,
        showInAnalysis: true,
        sortOrder: order++,
      })
    );
  }

  const structuredSections = A800RR_STRUCTURED_SECTIONS.map((sec) => ({
    id: sec.id,
    title: sec.title,
    rows: sec.rows
      .filter((row): row is Extract<typeof row, { type: "single" } | { type: "pair" }> =>
        row.type === "single" || row.type === "pair"
      )
      .map((row) => {
        if (row.type === "pair") {
          return {
            type: "pair" as const,
            label: row.label,
            unit: row.unit,
            leftKey: row.leftKey,
            rightKey: row.rightKey,
          };
        }
        if (row.type === "single") {
          return {
            type: "single" as const,
            key: row.key,
            label: row.label,
            unit: row.unit,
            multiline: row.multiline,
          };
        }
        return null;
      })
      .filter(Boolean) as SetupSheetModelSchema["structuredSections"][0]["rows"],
  }));

  return {
    version: 1,
    label: "Awesomatix A800RR",
    structuredSections,
    fields,
  };
}

/** Ensure user has built-in A800 model; link legacy A800 cars. */
export async function ensureA800SetupSheetModelForUser(userId: string): Promise<string> {
  const schema = buildA800SeedSchema();
  const existing = await prisma.setupSheetModel.findUnique({
    where: { userId_slug: { userId, slug: SETUP_SHEET_MODEL_SLUG_A800RR } },
    select: { id: true },
  });
  if (existing) {
    await prisma.setupSheetModel.update({
      where: { id: existing.id },
      data: { schemaJson: schema as object, name: "Awesomatix A800RR" },
    });
    await linkLegacyA800Cars(userId, existing.id);
    return existing.id;
  }
  const created = await prisma.setupSheetModel.create({
    data: {
      userId,
      name: "Awesomatix A800RR",
      slug: SETUP_SHEET_MODEL_SLUG_A800RR,
      schemaJson: schema as object,
    },
    select: { id: true },
  });
  await linkLegacyA800Cars(userId, created.id);
  return created.id;
}

async function linkLegacyA800Cars(userId: string, modelId: string): Promise<void> {
  await prisma.car.updateMany({
    where: {
      userId,
      setupSheetTemplate: SETUP_SHEET_TEMPLATE_A800RR,
      setupSheetModelId: null,
    },
    data: { setupSheetModelId: modelId },
  });
}
