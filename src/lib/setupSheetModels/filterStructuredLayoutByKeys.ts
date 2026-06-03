import type { SetupSheetModelLayoutRow, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/** Keys referenced by a model layout row (for visibility filtering). */
export function modelLayoutRowKeys(row: SetupSheetModelLayoutRow): string[] {
  if (row.type === "single") return [row.key];
  if (row.type === "pair") return [row.leftKey, row.rightKey];
  if (row.type === "corner4") return [row.ff, row.fr, row.rf, row.rr];
  if (row.type === "screw_strip") return [row.key];
  if (row.type === "top_deck_block") {
    return [
      "top_deck_front",
      "top_deck_rear",
      "top_deck_cuts",
      "top_deck_single",
      "motor_mount_screws",
      "top_deck_screws",
    ];
  }
  return [];
}

/** Drop layout rows whose keys are all hidden; drop empty sections. */
export function filterModelLayoutSectionsByKeys(
  sections: SetupSheetModelSchema["structuredSections"],
  keyVisible: (key: string) => boolean
): SetupSheetModelSchema["structuredSections"] {
  return sections
    .map((sec) => ({
      ...sec,
      rows: sec.rows.filter((row) => modelLayoutRowKeys(row).some((k) => keyVisible(k))),
    }))
    .filter((sec) => sec.rows.length > 0);
}

/** All stable keys referenced by the structured layout rows. */
export function collectModelLayoutKeys(
  sections: SetupSheetModelSchema["structuredSections"]
): Set<string> {
  const keys = new Set<string>();
  for (const sec of sections) {
    for (const row of sec.rows) {
      for (const k of modelLayoutRowKeys(row)) keys.add(k);
    }
  }
  return keys;
}
