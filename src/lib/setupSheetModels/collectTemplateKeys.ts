import type { StructuredRow } from "@/lib/a800rrSetupDisplayConfig";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

function collectRowKeys(row: StructuredRow, keys: Set<string>) {
  switch (row.type) {
    case "single":
      keys.add(row.key);
      break;
    case "pair":
      keys.add(row.leftKey);
      keys.add(row.rightKey);
      break;
    case "corner4":
      keys.add(row.ff);
      keys.add(row.fr);
      keys.add(row.rf);
      keys.add(row.rr);
      break;
    case "screw_strip":
      keys.add(row.key);
      break;
    case "top_deck_block":
      break;
    default:
      break;
  }
}

/** All canonical setup snapshot keys declared on a setup sheet template. */
export function collectSetupSheetTemplateKeys(template: SetupSheetTemplate): Set<string> {
  const keys = new Set<string>();
  for (const g of template.groups) {
    for (const f of g.fields) keys.add(f.key);
  }
  for (const sec of template.structuredSections ?? []) {
    for (const row of sec.rows) collectRowKeys(row, keys);
  }
  return keys;
}
