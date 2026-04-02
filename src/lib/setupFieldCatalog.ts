import type { SetupSheetFieldDef, SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import type { StructuredSection } from "@/lib/a800rrSetupDisplayConfig";

export type SetupFieldMeta = {
  key: string;
  label: string;
  unit?: string;
  /** Stable group id for future compare UX. */
  groupId: string;
  groupTitle: string;
};

function pushMeta(
  out: SetupFieldMeta[],
  seen: Set<string>,
  key: string,
  label: string,
  unit: string | undefined,
  groupId: string,
  groupTitle: string
) {
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ key, label, unit, groupId, groupTitle });
}

function flattenStructuredSection(sec: StructuredSection, out: SetupFieldMeta[], seen: Set<string>) {
  for (const row of sec.rows) {
    if (row.type === "single") {
      pushMeta(out, seen, row.key, row.label, row.unit, sec.id, sec.title);
    } else if (row.type === "pair") {
      pushMeta(out, seen, row.leftKey, `${row.label} · Front`, row.unit, sec.id, sec.title);
      pushMeta(out, seen, row.rightKey, `${row.label} · Rear`, row.unit, sec.id, sec.title);
    } else if (row.type === "corner4") {
      pushMeta(out, seen, row.ff, `${row.label} · FF`, row.unit, sec.id, sec.title);
      pushMeta(out, seen, row.fr, `${row.label} · FR`, row.unit, sec.id, sec.title);
      pushMeta(out, seen, row.rf, `${row.label} · RF`, row.unit, sec.id, sec.title);
      pushMeta(out, seen, row.rr, `${row.label} · RR`, row.unit, sec.id, sec.title);
    } else if (row.type === "top_deck_block") {
      pushMeta(out, seen, "top_deck_front", "Top deck · Front", undefined, sec.id, sec.title);
      pushMeta(out, seen, "top_deck_rear", "Top deck · Rear", undefined, sec.id, sec.title);
      pushMeta(out, seen, "top_deck_cuts", "Top deck cuts", undefined, sec.id, sec.title);
      pushMeta(out, seen, "top_deck_single", "Top deck · Single", undefined, sec.id, sec.title);
    } else if (row.type === "screw_strip") {
      pushMeta(out, seen, row.key, row.label, undefined, sec.id, sec.title);
    }
  }
}

export function buildCatalogFromTemplate(template: SetupSheetTemplate): SetupFieldMeta[] {
  const out: SetupFieldMeta[] = [];
  const seen = new Set<string>();
  if (template.structuredSections?.length) {
    for (const sec of template.structuredSections) {
      flattenStructuredSection(sec, out, seen);
    }
    return out;
  }
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

