import { GENERIC_SETUP_SHEET_V1 } from "@/lib/setupSheetTemplate";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/** Build initial schema from the built-in generic touring preset. */
export function buildGenericPresetSchema(modelLabel: string): SetupSheetModelSchema {
  const fields: SetupSheetModelFieldDef[] = [];
  const keyMeta = new Map<string, { label: string; unit?: string; sectionId: string; sectionTitle: string }>();

  for (const sec of GENERIC_SETUP_SHEET_V1.structuredSections ?? []) {
    for (const row of sec.rows) {
      if (row.type === "pair") {
        keyMeta.set(row.leftKey, {
          label: `${row.label} (Front)`,
          unit: row.unit,
          sectionId: sec.id,
          sectionTitle: sec.title,
        });
        keyMeta.set(row.rightKey, {
          label: `${row.label} (Rear)`,
          unit: row.unit,
          sectionId: sec.id,
          sectionTitle: sec.title,
        });
      } else if (row.type === "single") {
        keyMeta.set(row.key, {
          label: row.label,
          unit: row.unit,
          sectionId: sec.id,
          sectionTitle: sec.title,
        });
      }
    }
  }

  let order = 0;
  for (const [key, meta] of keyMeta) {
    const isSession = meta.sectionId === "session";
    const isNotes = key.includes("notes") || key === "tires_setup";
    const isTireField = key === "tires" || key === "tires_setup";
    const sessionInAnalysis = key === "track_surface" || key === "traction";
    const sessionFieldExtras =
      key === "track_surface"
        ? {
            uiType: "select" as const,
            valueType: "enum" as const,
            groupBehaviorType: "singleSelect" as const,
            groupedOptionLabels: ["Asphalt", "Carpet"],
            groupedOptionValues: ["asphalt", "carpet"],
          }
        : key === "traction"
          ? {
              uiType: "multiSelect" as const,
              valueType: "multi" as const,
              groupBehaviorType: "multiChoiceGroup" as const,
              groupedOptionLabels: ["Low", "Medium", "High"],
              groupedOptionValues: ["low", "medium", "high"],
            }
          : null;

    const universalParameterId =
      key === "spring_rate_front"
        ? "spring_front"
        : key === "spring_rate_rear"
          ? "spring_rear"
          : undefined;

    fields.push({
      key,
      displayLabel: meta.label,
      sectionId: meta.sectionId,
      sectionTitle: meta.sectionTitle,
      valueType: sessionFieldExtras?.valueType ?? (isTireField ? "string" : isSession || isNotes ? "string" : "number"),
      uiType:
        sessionFieldExtras?.uiType ??
        (isTireField ? "tireType" : isSession ? "text" : isNotes ? "textarea" : "text"),
      unit: meta.unit,
      showInSetupSheet: true,
      showInAnalysis: !isSession || sessionInAnalysis,
      showInLogRun: true,
      sortOrder: order++,
      ...(universalParameterId ? { universalParameterId } : {}),
      ...(sessionFieldExtras
        ? {
            groupBehaviorType: sessionFieldExtras.groupBehaviorType,
            groupedOptionLabels: sessionFieldExtras.groupedOptionLabels,
            groupedOptionValues: sessionFieldExtras.groupedOptionValues,
          }
        : {}),
    });
  }

  const structuredSections = (GENERIC_SETUP_SHEET_V1.structuredSections ?? []).map((sec) => ({
    id: sec.id,
    title: sec.title,
    rows: sec.rows
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
      .filter((r): r is NonNullable<typeof r> => r != null),
  }));

  return {
    version: 1,
    label: modelLabel,
    structuredSections,
    fields,
  };
}
