import {
  inferLayoutGroupRoleFromField,
  stripSideFromLabel,
} from "@/lib/setupSheetModels/layoutGroupOps";
import { POSITION_LABELS, type PositionSplit } from "@/lib/setupSheetModels/newParameterDef";
import { UNIVERSAL_TOURING_PARAMETERS } from "@/lib/setupSheetModels/universalParameters";
import type { LayoutGroupRole, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * Parameter-name suggestions for the box-first naming panel, so a stem is typed once per sheet
 * rather than once per box. Names already on the sheet come first — the driver's own vocabulary
 * beats ours — then the universal concepts, which are the ones worth spelling consistently
 * because they pool stats across cars.
 *
 * `suggestedSplit` is what picking the suggestion pre-selects in the Positions row. It's a
 * pre-selection of a visible control, never a hidden decision.
 */
export type ParameterNameSuggestion = {
  /** Bare stem with any position stripped — "Camber". */
  stem: string;
  suggestedSplit: PositionSplit;
  /** Positions of this stem already on the sheet, so a duplicate is visible before saving. */
  existingPositions: string[];
  source: "sheet" | "universal";
};

const POSITION_LABEL_BY_ROLE: Record<LayoutGroupRole, string> = {
  front: "Front",
  rear: "Rear",
  ff: "FF",
  fr: "FR",
  rf: "RF",
  rr: "RR",
};

const CORNER_ROLES = new Set<LayoutGroupRole>(["ff", "fr", "rf", "rr"]);

/** Every position label, in reading order — a stem's existing positions are listed against this. */
const ALL_POSITION_LABELS: readonly string[] = [
  ...POSITION_LABELS.front_rear,
  ...POSITION_LABELS.corner4,
];

function splitForRoles(roles: Set<LayoutGroupRole>): PositionSplit {
  for (const role of roles) {
    if (CORNER_ROLES.has(role)) return "corner4";
  }
  return roles.has("front") || roles.has("rear") ? "front_rear" : "single";
}

/** Universal concepts as bare stems — the 16 registry entries collapse to 8 front/rear pairs. */
function universalStems(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const def of UNIVERSAL_TOURING_PARAMETERS) {
    const stem = stripSideFromLabel(def.label);
    if (!stem) continue;
    const norm = stem.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(stem);
  }
  return out;
}

/**
 * Stems matching `query` (substring, case-insensitive). Empty query returns nothing — the panel
 * autofocuses the name box, and suggesting on focus would cover the rest of the form every time.
 */
export function parameterNameSuggestions(
  schema: Pick<SetupSheetModelSchema, "fields">,
  query: string,
  limit = 8
): ParameterNameSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const rolesByStem = new Map<string, { stem: string; roles: Set<LayoutGroupRole> }>();
  for (const field of schema.fields) {
    const stem = stripSideFromLabel(field.displayLabel).trim();
    if (!stem) continue;
    const norm = stem.toLowerCase();
    let entry = rolesByStem.get(norm);
    if (!entry) {
      entry = { stem, roles: new Set() };
      rolesByStem.set(norm, entry);
    }
    const role = field.layoutGroupRole ?? inferLayoutGroupRoleFromField(field);
    if (role) entry.roles.add(role);
  }

  const out: ParameterNameSuggestion[] = [];
  const taken = new Set<string>();

  for (const [norm, { stem, roles }] of rolesByStem) {
    if (!norm.includes(q)) continue;
    const present = new Set([...roles].map((r) => POSITION_LABEL_BY_ROLE[r]));
    out.push({
      stem,
      suggestedSplit: splitForRoles(roles),
      existingPositions: ALL_POSITION_LABELS.filter((label) => present.has(label)),
      source: "sheet",
    });
    taken.add(norm);
  }

  for (const stem of universalStems()) {
    const norm = stem.toLowerCase();
    if (taken.has(norm) || !norm.includes(q)) continue;
    out.push({ stem, suggestedSplit: "front_rear", existingPositions: [], source: "universal" });
    taken.add(norm);
  }

  return out.slice(0, limit);
}
