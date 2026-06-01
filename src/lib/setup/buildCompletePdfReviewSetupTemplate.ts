import type { StructuredSection } from "@/lib/a800rrSetupDisplayConfig";
import { collectStructuredFieldKeys } from "@/lib/a800rrSetupDisplayConfig";
import type { SetupSnapshotData } from "@/lib/runSetup";
import {
  appendMissingCalibrationCatalogToStructuredSections,
  getA800rrSetupSheetTemplateWithDisplayPreferences,
} from "@/lib/setupCalibrations/customFieldCatalog";
import { buildCalibrationFieldCatalog } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { isDerivedSetupKey } from "@/lib/setupCalculations/a800rrDerived";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";

const OMIT_ORPHAN_KEYS = new Set([
  "top_deck_front_other",
  "top_deck_rear_other",
  "top_deck_single_other",
  "notes",
  "tires_setup",
]);

const CATALOG_LABEL_BY_KEY = Object.fromEntries(
  buildCalibrationFieldCatalog().map((f) => [f.key, f.label])
);

function humanizeSetupKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function labelForSetupKey(key: string): string {
  return CATALOG_LABEL_BY_KEY[key] ?? humanizeSetupKey(key);
}

/** Keys present in snapshot data but not laid out on the base template. */
function appendOrphanSetupDataSections(
  sections: StructuredSection[],
  setupData: SetupSnapshotData
): StructuredSection[] {
  const existing = new Set(collectStructuredFieldKeys(sections));
  const rows: StructuredSection["rows"] = [];

  for (const key of Object.keys(setupData).sort()) {
    if (isDerivedSetupKey(key)) continue;
    if (OMIT_ORPHAN_KEYS.has(key)) continue;
    if (existing.has(key)) continue;
    rows.push({
      type: "single",
      key,
      label: labelForSetupKey(key),
    });
    existing.add(key);
  }

  if (rows.length === 0) return sections;

  return [
    ...sections,
    {
      id: "imported_fields",
      title: "Additional imported fields",
      rows,
    },
  ];
}

function expandStructuredSections(
  sections: StructuredSection[],
  setupData: SetupSnapshotData
): StructuredSection[] {
  const withCatalog = appendMissingCalibrationCatalogToStructuredSections(sections, "setup");
  return appendOrphanSetupDataSections(withCatalog, setupData);
}

/**
 * Full setup sheet for PDF review: base car template + supplemental catalog fields
 * (motor, ESC, spur, …) + any keys imported into the snapshot but not on the layout.
 */
export function buildCompletePdfReviewSetupTemplate(params: {
  baseTemplate: SetupSheetTemplate;
  setupData: SetupSnapshotData;
  carSetupSheetTemplate: string | null;
}): SetupSheetTemplate {
  const { baseTemplate, setupData, carSetupSheetTemplate } = params;

  if (isA800RRCar(carSetupSheetTemplate)) {
    const full = getA800rrSetupSheetTemplateWithDisplayPreferences(null, null, "setup");
    const sections = expandStructuredSections(full.structuredSections ?? [], setupData);
    return {
      ...full,
      id: baseTemplate.id || full.id,
      label: baseTemplate.label || full.label,
      fieldChipOptionsByKey:
        baseTemplate.fieldChipOptionsByKey ?? full.fieldChipOptionsByKey,
      structuredSections: sections,
    };
  }

  const baseSections = baseTemplate.structuredSections ?? [];
  if (baseSections.length > 0) {
    return {
      ...baseTemplate,
      structuredSections: expandStructuredSections(baseSections, setupData),
    };
  }

  // Legacy group-only templates: append imported orphans as a full-width group.
  const existingGroupKeys = new Set(baseTemplate.groups.flatMap((g) => g.fields.map((f) => f.key)));
  const orphanFields = Object.keys(setupData)
    .filter(
      (key) =>
        !isDerivedSetupKey(key) &&
        !OMIT_ORPHAN_KEYS.has(key) &&
        !existingGroupKeys.has(key)
    )
    .sort()
    .map((key) => ({
      key,
      label: labelForSetupKey(key),
      editable: true,
      input: "text" as const,
    }));

  if (orphanFields.length === 0) {
    return {
      ...baseTemplate,
      structuredSections: expandStructuredSections([], setupData),
    };
  }

  return {
    ...baseTemplate,
    groups: [
      ...baseTemplate.groups,
      {
        id: "imported_fields",
        title: "Additional imported fields",
        column: "full",
        fields: orphanFields,
      },
    ],
  };
}
