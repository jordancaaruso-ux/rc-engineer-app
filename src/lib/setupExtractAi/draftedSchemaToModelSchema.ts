import type { DraftedField } from "@/lib/setupExtractAi/draftSetupSheetModelSchema";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { inferSectionLayoutRows } from "@/lib/setupSheetModels/inferStructuredLayout";

/**
 * Convert an AI-drafted schema (Stage 1.5) into a real SetupSheetModelSchema — the shape
 * stored in SetupSheetModel.schemaJson and consumed by parseSetupSheetModelSchema.
 *
 * Pure, and currently used only by `scripts/setup-extract-eval/*`. There is no DB write behind
 * it any more: `ensureSheetModelForUpload` was deleted 2026-08-06 when automated chassis
 * onboarding was abandoned (sheets are authored by hand — see docs/SETUP_UPLOAD_NORTH_STAR.md).
 */

function sectionIdFromTitle(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "other";
}

export function draftedSchemaToModelSchema(input: {
  carName: string;
  fields: DraftedField[];
}): SetupSheetModelSchema {
  const fieldDefs: SetupSheetModelFieldDef[] = input.fields.map((f, i) => {
    const sectionTitle = f.section.trim() || "Other";
    const choice = f.valueType === "choice" && (f.options?.length ?? 0) > 0;
    return {
      key: f.key,
      displayLabel: f.displayLabel,
      sectionId: sectionIdFromTitle(sectionTitle),
      sectionTitle,
      valueType: choice ? "enum" : "string",
      uiType: choice ? "groupOption" : "text",
      showInSetupSheet: true,
      showInAnalysis: true,
      showInLogRun: true,
      sortOrder: i,
      ...(choice
        ? {
            groupBehaviorType: "singleChoiceGroup" as const,
            groupedOptionLabels: f.options,
            groupedOptionValues: f.options,
          }
        : {}),
      ...(f.universalParameterId ? { universalParameterId: f.universalParameterId } : {}),
    };
  });

  // Sections in first-seen order; rows inferred per section (pairs/corner4 from key suffixes).
  const sectionOrder: string[] = [];
  const bySection = new Map<string, SetupSheetModelFieldDef[]>();
  for (const f of fieldDefs) {
    if (!bySection.has(f.sectionId)) {
      bySection.set(f.sectionId, []);
      sectionOrder.push(f.sectionId);
    }
    bySection.get(f.sectionId)!.push(f);
  }
  const structuredSections = sectionOrder.map((id) => {
    const fields = bySection.get(id)!;
    return {
      id,
      title: fields[0]!.sectionTitle,
      rows: inferSectionLayoutRows(fields),
    };
  });

  return {
    version: 1,
    label: input.carName,
    structuredSections,
    fields: fieldDefs,
  };
}
