import { GENERIC_SETUP_SHEET_V1 } from "@/lib/setupSheetTemplate";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { universalParameterIdForSnapshotKey } from "@/lib/setupSheetModels/universalParameters";

/**
 * Help text for fields a driver can plausibly fill in wrong.
 *
 * Droop and downstop are the live case: plenty of people use the words interchangeably, but they
 * are different measurements, and the typical magnitudes make a mix-up obvious once stated.
 */
const FIELD_NOTES: Record<string, string> = {
  droop_front: "Measured ground to wheel — typically 21-24 mm.",
  droop_rear: "Measured ground to wheel — typically 21-24 mm.",
  downstop_front: "Measured ground to bottom of arm — typically 4-7 mm.",
  downstop_rear: "Measured ground to bottom of arm — typically 4-7 mm.",
};

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
      } else if (row.type === "corner4") {
        // Four bulkhead pickup points, not four corners — FF/FR are the front bulkhead's front and
        // rear pickup, RF/RR the rear bulkhead's. Left/right are symmetric.
        for (const [position, key] of [
          ["FF", row.ff],
          ["FR", row.fr],
          ["RF", row.rf],
          ["RR", row.rr],
        ] as const) {
          keyMeta.set(key, {
            label: `${row.label} (${position})`,
            unit: row.unit,
            sectionId: sec.id,
            sectionTitle: sec.title,
          });
        }
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

    // Resolved from the shared registry rather than hand-mapped, so every preset field that names
    // a cross-car concept pools into the same bucket — and a future sheet that spells it slightly
    // differently maps here too instead of minting a near-duplicate parameter.
    const universalParameterId = universalParameterIdForSnapshotKey(key);
    const notes = FIELD_NOTES[key];

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
      ...(notes ? { notes } : {}),
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
        if (row.type === "corner4") {
          return {
            type: "corner4" as const,
            label: row.label,
            unit: row.unit,
            ff: row.ff,
            fr: row.fr,
            rf: row.rf,
            rr: row.rr,
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
