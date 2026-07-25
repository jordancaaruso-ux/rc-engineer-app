import {
  universalParameterIdForSnapshotKey,
  type UniversalParameterDef,
  UNIVERSAL_TOURING_PARAMETERS,
} from "@/lib/setupSheetModels/universalParameters";

/**
 * Best-effort mapping of an arbitrary setup field (key + human label) to a canonical
 * cross-car universal parameter id, so AI-drafted schemas for a brand-new car keep that
 * car in community aggregations (see universalParameters.ts).
 *
 * The exact registry alias map (`universalParameterIdForSnapshotKey`) is tried first; this
 * adds concept + axle heuristics for novel field names a schema drafter might invent
 * ("front ride height", "rear downstop", "toe-in rear"). Deliberately conservative — returns
 * undefined rather than guess, because a wrong universal mapping pollutes cross-car stats.
 */

type Axle = "front" | "rear" | null;

function detectAxle(text: string): Axle {
  const t = ` ${text.toLowerCase().replace(/[^a-z]+/g, " ")} `;
  // Explicit words win; then common sheet prefixes (Xray uses fr-/re-, others f/r).
  if (/\b(front|frt|fr)\b/.test(t) && !/\b(rear|rr|re)\b/.test(t)) return "front";
  if (/\b(rear|rr|re)\b/.test(t) && !/\b(front|frt|fr)\b/.test(t)) return "rear";
  if (/\bfront\b/.test(t)) return "front";
  if (/\brear\b/.test(t)) return "rear";
  return null;
}

/**
 * concept keyword → the front/rear pair of canonical ids, or `single` when the concept has no axle.
 *
 * Order matters: the first match wins, so a more specific concept must precede a looser one that
 * would also match its text (downstop before droop).
 *
 * NOTE — the four-point link stacks (`upper_inner_shims_ff`, …) are deliberately absent. They are
 * covered by the exact registry hit in step 1, and a keyword heuristic can't safely infer which of
 * four pickups a novel label means; guessing there would pollute stats far worse than returning
 * undefined. `detectAxle` would also mis-read "fr"/"rr" suffixes as front/rear axles.
 */
const CONCEPTS: Array<{ test: RegExp; front?: string; rear?: string; single?: string }> = [
  { test: /\btoe\s*gain\b/, rear: "toe_gain_shims_rear" },
  { test: /bump\s*steer/, front: "bump_steer_shims_front" },
  { test: /\btoe\b/, front: "toe_front", rear: "toe_rear" },
  { test: /ride\s*height|ride\s*ht|\brh\b/, front: "ride_height_front", rear: "ride_height_rear" },
  // Split 2026-07-25: these are different measurements, not synonyms — see universalParameters.ts.
  { test: /downstop|down\s*stop/, front: "downstop_front", rear: "downstop_rear" },
  { test: /droop/, front: "droop_front", rear: "droop_rear" },
  { test: /camber/, front: "camber_front", rear: "camber_rear" },
  { test: /caster|castor/, front: "caster_front", rear: "caster_rear" },
  { test: /anti[-\s]*roll|sway\s*bar|roll\s*bar|\barb\b/, front: "arb_front", rear: "arb_rear" },
  { test: /diff\s*oil/, single: "diff_oil" },
  { test: /shock\s*oil|damper\s*oil/, front: "damper_oil_front", rear: "damper_oil_rear" },
  { test: /spring/, front: "spring_front", rear: "spring_rear" },
];

export function suggestUniversalParameterId(key: string, label?: string): string | undefined {
  // 1) Exact registry / alias hit on the stored key.
  const direct = universalParameterIdForSnapshotKey(key);
  if (direct) return direct;

  // 2) Concept + axle heuristics. Separators normalize to spaces (`toe_out_front` must match
  // \btoe\b like "Toe out"). Concept detection ignores parenthetical label text — parens hold
  // units and location hints ("FF shim (mm, front ride height block)") that would otherwise
  // map a shim into ride-height stats. Axle detection keeps the full text ("Camber (Front)").
  const labelSansParens = (label ?? "").replace(/\([^)]*\)/g, " ");
  const conceptHaystack = `${key} ${labelSansParens}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const axleHaystack = `${key} ${label ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const axle = detectAxle(axleHaystack);
  for (const c of CONCEPTS) {
    if (!c.test.test(conceptHaystack)) continue;
    // Axle-less concepts (diff oil) resolve without needing a side.
    if (c.single) return c.single;
    if (axle === "front" && c.front) return c.front;
    if (axle === "rear" && c.rear) return c.rear;
    // Concept matched but axle ambiguous, or it only exists on one axle → don't guess a side.
    return undefined;
  }
  return undefined;
}

/** The canonical set, for prompting a schema drafter to reuse these ids for universal concepts. */
export function universalParameterCatalogForPrompt(): UniversalParameterDef[] {
  return UNIVERSAL_TOURING_PARAMETERS;
}
