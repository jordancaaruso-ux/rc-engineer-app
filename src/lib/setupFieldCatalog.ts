import type { SetupSheetFieldDef, SetupSheetTemplate } from "@/lib/setupSheetTemplate";

export type SetupFieldMeta = {
  key: string;
  label: string;
  unit?: string;
  /** Stable group id for future compare UX. */
  groupId: string;
  groupTitle: string;
};

export function buildCatalogFromTemplate(template: SetupSheetTemplate): SetupFieldMeta[] {
  const out: SetupFieldMeta[] = [];
  const seen = new Set<string>();
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      out.push({
        key: f.key,
        label: f.label,
        unit: f.unit,
        groupId: g.id,
        groupTitle: g.title,
      });
    }
  }
  return out;
}

export function buildFieldMetaMap(fields: SetupFieldMeta[]): Map<string, SetupFieldMeta> {
  return new Map(fields.map((f) => [f.key, f]));
}

export function toTemplateFields(fields: SetupFieldMeta[]): SetupSheetFieldDef[] {
  return fields.map((f) => ({ key: f.key, label: f.label, unit: f.unit }));
}

