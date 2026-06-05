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
import { countCatalogFieldsMissingFromLayout } from "@/lib/setupSheetModels/layoutEditorOps";
import { inferStructuredLayoutFromFields } from "@/lib/setupSheetModels/inferStructuredLayout";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import type {
  SetupSheetModelFieldDef,
  SetupSheetModelLayoutRow,
  SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";

export { SETUP_SHEET_MODEL_SLUG_A800RR } from "@/lib/setupSheetTemplateId";

function structuredRowToModelLayout(row: (typeof A800RR_STRUCTURED_SECTIONS)[0]["rows"][0]): SetupSheetModelLayoutRow | null {
  if (row.type === "single") {
    return {
      type: "single",
      key: row.key,
      label: row.label,
      unit: row.unit,
      multiline: row.multiline,
    };
  }
  if (row.type === "pair") {
    return {
      type: "pair",
      label: row.label,
      unit: row.unit,
      leftKey: row.leftKey,
      rightKey: row.rightKey,
    };
  }
  if (row.type === "corner4") {
    return {
      type: "corner4",
      ff: row.ff,
      fr: row.fr,
      rf: row.rf,
      rr: row.rr,
      label: row.label,
      unit: row.unit,
    };
  }
  if (row.type === "screw_strip") {
    return { type: "screw_strip", key: row.key, label: row.label };
  }
  if (row.type === "top_deck_block") {
    return { type: "top_deck_block" };
  }
  return null;
}

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
        showInLogRun: true,
        sortOrder: order++,
      })
    );
  }

  const structuredSections = inferStructuredLayoutFromFields(
    fields,
    A800RR_STRUCTURED_SECTIONS.map((sec) => ({
      id: sec.id,
      title: sec.title,
      rows: sec.rows
        .map((row) => structuredRowToModelLayout(row))
        .filter((row): row is SetupSheetModelLayoutRow => row != null),
    }))
  );

  return {
    version: 1,
    label: "Awesomatix A800RR",
    structuredSections,
    fields,
  };
}

/** Ensure user has built-in A800 model; link legacy A800 cars. */
export async function ensureA800SetupSheetModelForUser(userId: string): Promise<string> {
  const seedSchema = buildA800SeedSchema();
  const existing = await prisma.setupSheetModel.findUnique({
    where: { userId_slug: { userId, slug: SETUP_SHEET_MODEL_SLUG_A800RR } },
    select: { id: true, schemaJson: true },
  });
  if (existing) {
    const parsed = parseSetupSheetModelSchema(existing.schemaJson);
    if (parsed && countCatalogFieldsMissingFromLayout(parsed) > 5) {
      await prisma.setupSheetModel.update({
        where: { id: existing.id },
        data: {
          schemaJson: {
            ...parsed,
            structuredSections: inferStructuredLayoutFromFields(
              parsed.fields,
              seedSchema.structuredSections
            ),
          } as object,
        },
      });
    }
    await linkLegacyA800Cars(userId, existing.id);
    return existing.id;
  }
  const created = await prisma.setupSheetModel.create({
    data: {
      userId,
      name: "Awesomatix A800RR",
      slug: SETUP_SHEET_MODEL_SLUG_A800RR,
      schemaJson: seedSchema as object,
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
