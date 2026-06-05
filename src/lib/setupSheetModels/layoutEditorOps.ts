import { collectModelLayoutKeys, modelLayoutRowKeys } from "@/lib/setupSheetModels/filterStructuredLayoutByKeys";
import type {
  SetupSheetModelLayoutRow,
  SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";

export function rowLabel(row: SetupSheetModelLayoutRow): string {
  if (row.type === "single") return row.label || row.key;
  if (row.type === "pair") return row.label || `${row.leftKey} / ${row.rightKey}`;
  if (row.type === "corner4") return row.label || row.ff;
  if (row.type === "screw_strip") return row.label || row.key;
  if (row.type === "top_deck_block") return "Top deck block";
  return "Row";
}

function rowAlreadyInLayout(
  sections: SetupSheetModelSchema["structuredSections"],
  fieldKey: string
): boolean {
  for (const sec of sections) {
    for (const row of sec.rows) {
      if (modelLayoutRowKeys(row).includes(fieldKey)) return true;
    }
  }
  return false;
}

/** Append a single row for a catalog field (does not remove from fields[]). */
export function addFieldToLayout(
  schema: SetupSheetModelSchema,
  fieldKey: string
): SetupSheetModelSchema | { error: string } {
  const field = schema.fields.find((f) => f.key === fieldKey);
  if (!field) return { error: `Unknown field "${fieldKey}".` };
  if (rowAlreadyInLayout(schema.structuredSections, fieldKey)) {
    return { error: `"${field.displayLabel}" is already on the sheet layout.` };
  }

  const row: SetupSheetModelLayoutRow = {
    type: "single",
    key: field.key,
    label: field.displayLabel,
    unit: field.unit,
    multiline: field.uiType === "textarea",
  };

  const secIdx = schema.structuredSections.findIndex((s) => s.id === field.sectionId);
  if (secIdx >= 0) {
    const sections = schema.structuredSections.map((s, i) =>
      i === secIdx ? { ...s, rows: [...s.rows, row] } : s
    );
    return { ...schema, structuredSections: sections };
  }

  return {
    ...schema,
    structuredSections: [
      ...schema.structuredSections,
      { id: field.sectionId, title: field.sectionTitle, rows: [row] },
    ],
  };
}

/** Remove one layout row; catalog field defs are unchanged. */
export function removeRowFromLayout(
  schema: SetupSheetModelSchema,
  sectionId: string,
  rowIndex: number
): SetupSheetModelSchema | { error: string } {
  const secIdx = schema.structuredSections.findIndex((s) => s.id === sectionId);
  if (secIdx < 0) return { error: "Section not found." };
  const sec = schema.structuredSections[secIdx]!;
  if (rowIndex < 0 || rowIndex >= sec.rows.length) return { error: "Row not found." };

  const rows = sec.rows.filter((_, i) => i !== rowIndex);
  const sections = schema.structuredSections
    .map((s, i) => (i === secIdx ? { ...s, rows } : s))
    .filter((s) => s.rows.length > 0);

  return { ...schema, structuredSections: sections };
}

export function reorderRow(
  schema: SetupSheetModelSchema,
  sectionId: string,
  fromIndex: number,
  toIndex: number
): SetupSheetModelSchema | { error: string } {
  if (fromIndex === toIndex) return schema;
  const secIdx = schema.structuredSections.findIndex((s) => s.id === sectionId);
  if (secIdx < 0) return { error: "Section not found." };
  const sec = schema.structuredSections[secIdx]!;
  if (fromIndex < 0 || fromIndex >= sec.rows.length || toIndex < 0 || toIndex >= sec.rows.length) {
    return { error: "Invalid row index." };
  }

  const rows = [...sec.rows];
  const [moved] = rows.splice(fromIndex, 1);
  rows.splice(toIndex, 0, moved!);

  const sections = schema.structuredSections.map((s, i) =>
    i === secIdx ? { ...s, rows } : s
  );
  return { ...schema, structuredSections: sections };
}

export function reorderSections(
  schema: SetupSheetModelSchema,
  fromIndex: number,
  toIndex: number
): SetupSheetModelSchema | { error: string } {
  if (fromIndex === toIndex) return schema;
  const sections = [...schema.structuredSections];
  if (fromIndex < 0 || fromIndex >= sections.length || toIndex < 0 || toIndex >= sections.length) {
    return { error: "Invalid section index." };
  }
  const [moved] = sections.splice(fromIndex, 1);
  sections.splice(toIndex, 0, moved!);
  return { ...schema, structuredSections: sections };
}

export function renameSectionTitle(
  schema: SetupSheetModelSchema,
  sectionId: string,
  title: string
): SetupSheetModelSchema | { error: string } {
  const trimmed = title.trim();
  if (!trimmed) return { error: "Section title is required." };
  const secIdx = schema.structuredSections.findIndex((s) => s.id === sectionId);
  if (secIdx < 0) return { error: "Section not found." };
  const sections = schema.structuredSections.map((s, i) =>
    i === secIdx ? { ...s, title: trimmed } : s
  );
  return { ...schema, structuredSections: sections };
}

/** Catalog fields not referenced by any layout row. */
export function fieldsNotInLayout(schema: SetupSheetModelSchema): SetupSheetModelSchema["fields"] {
  const layoutKeys = collectModelLayoutKeys(schema.structuredSections);
  return schema.fields.filter((f) => !layoutKeys.has(f.key));
}

/** Count catalog fields missing from layout (for stale-layout detection). */
export function countCatalogFieldsMissingFromLayout(schema: SetupSheetModelSchema): number {
  const layoutKeys = collectModelLayoutKeys(schema.structuredSections);
  return schema.fields.filter((f) => !layoutKeys.has(f.key)).length;
}
