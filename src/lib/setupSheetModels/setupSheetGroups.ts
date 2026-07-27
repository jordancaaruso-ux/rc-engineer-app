import type { StructuredRow, StructuredSection } from "@/lib/a800rrSetupDisplayConfig";
import {
  canonicalAggregationParameterKey,
  UNIVERSAL_TOURING_PARAMETERS,
} from "@/lib/setupSheetModels/universalParameters";

/**
 * The app's one display vocabulary for setup-sheet parameters.
 *
 * Every car's stored schema keeps its own `sectionId`/`sectionTitle` (they are structural keys read
 * by the editors, layout ops and calibration mapping — see `buildSetupSheetTemplate`). This module
 * sits *on top* of that: it derives a universal group per field at template-build time so a Mugen
 * sheet and an Awesomatix sheet read the same way, without migrating a single stored row.
 *
 * Axis is location-on-car, and that is a deliberate choice:
 *  - a physics axis can't work — ARB is roll couple AND transfer speed, so one knob would need
 *    three homes, and a rendered field must have exactly one;
 *  - a workflow axis ("what you change trackside") would assert a tuning method, which the app
 *    must never do.
 * Location is the only axis where every field has a single unambiguous home, and it is what the
 * printed brand sheets already use.
 *
 * Group ORDER is outboard suspension -> inboard suspension -> driveline -> chassis -> bodywork.
 * It is not a tuning order and must not be re-sorted into one. Tyres sit last for exactly that
 * reason: they are the biggest grip lever, and putting them first would read as "start here".
 */
export type SetupSheetGroupId =
  | "suspension_geometry"
  | "shocks_springs"
  | "links_shims"
  | "drivetrain"
  | "chassis_flex"
  | "body_tyres_weight"
  | "other";

export const SETUP_SHEET_GROUPS: ReadonlyArray<{ id: SetupSheetGroupId; title: string }> = [
  { id: "suspension_geometry", title: "Suspension geometry" },
  { id: "shocks_springs", title: "Shocks & springs" },
  { id: "links_shims", title: "Links & shims" },
  { id: "drivetrain", title: "Drivetrain" },
  { id: "chassis_flex", title: "Chassis & flex" },
  { id: "body_tyres_weight", title: "Body, tyres & weight" },
  /**
   * Trailing catch-all. Holds free-text notes and the session/conditions fields that older sheets
   * still carry (a run's conditions now come from the run itself, so they get no group of their
   * own). It exists so regrouping can never drop a row — see `regroupStructuredSections`.
   */
  { id: "other", title: "Other" },
];

/**
 * Explicit homes for keys the app ships. Checked before the universal registry so a platform key
 * that never became a universal parameter (Awesomatix SRS, top-deck screws) still lands correctly.
 */
const EXPLICIT_GROUP_BY_KEY: Record<string, SetupSheetGroupId> = {
  // --- Suspension geometry ---
  camber_front: "suspension_geometry",
  camber_rear: "suspension_geometry",
  caster_front: "suspension_geometry",
  caster_rear: "suspension_geometry",
  toe_front: "suspension_geometry",
  toe_rear: "suspension_geometry",
  ride_height_front: "suspension_geometry",
  ride_height_rear: "suspension_geometry",
  droop_front: "suspension_geometry",
  droop_rear: "suspension_geometry",
  downstop_front: "suspension_geometry",
  downstop_rear: "suspension_geometry",
  upstop_front: "suspension_geometry",
  upstop_rear: "suspension_geometry",
  inner_steering_angle: "suspension_geometry",

  // --- Shocks & springs ---
  spring_front: "shocks_springs",
  spring_rear: "shocks_springs",
  spring_rate_front: "shocks_springs",
  spring_rate_rear: "shocks_springs",
  front_spring_rate_gf_mm: "shocks_springs",
  rear_spring_rate_gf_mm: "shocks_springs",
  spring_gap_front: "shocks_springs",
  spring_gap_rear: "shocks_springs",
  damper_oil_front: "shocks_springs",
  damper_oil_rear: "shocks_springs",
  shock_oil_front: "shocks_springs",
  shock_oil_rear: "shocks_springs",
  damper_percent_front: "shocks_springs",
  damper_percent_rear: "shocks_springs",
  damping_front: "shocks_springs",
  damping_rear: "shocks_springs",
  srs_arrangement_front: "shocks_springs",
  srs_arrangement_rear: "shocks_springs",
  pss_percent_setup_front: "shocks_springs",
  pss_percent_setup_rear: "shocks_springs",
  arb_front: "shocks_springs",
  arb_rear: "shocks_springs",

  // --- Links & shims ---
  upper_inner_shims_ff: "links_shims",
  upper_inner_shims_fr: "links_shims",
  upper_inner_shims_rf: "links_shims",
  upper_inner_shims_rr: "links_shims",
  under_lower_arm_shims_ff: "links_shims",
  under_lower_arm_shims_fr: "links_shims",
  under_lower_arm_shims_rf: "links_shims",
  under_lower_arm_shims_rr: "links_shims",
  upper_outer_shims_front: "links_shims",
  upper_outer_shims_rear: "links_shims",
  under_hub_shims_front: "links_shims",
  under_hub_shims_rear: "links_shims",
  bump_steer_shims_front: "links_shims",
  toe_gain_shims_rear: "links_shims",

  // --- Drivetrain ---
  diff: "drivetrain",
  diff_oil: "drivetrain",
  diff_shims: "drivetrain",
  // Awesomatix prints diff height under Geometry; it is a driveline decision, so it moves here.
  diff_height_front: "drivetrain",
  diff_height_rear: "drivetrain",

  // --- Chassis & flex ---
  c45_installed_front: "chassis_flex",
  c45_installed_rear: "chassis_flex",
  top_deck_front: "chassis_flex",
  top_deck_rear: "chassis_flex",
  top_deck_single: "chassis_flex",
  top_deck_screws: "chassis_flex",
  top_deck_cuts: "chassis_flex",
  motor_mount_screws: "chassis_flex",
  chassis: "chassis_flex",
  front_bumper: "chassis_flex",

  // --- Body, tyres & weight ---
  bodyshell: "body_tyres_weight",
  wing: "body_tyres_weight",
  tires: "body_tyres_weight",
  tires_setup: "body_tyres_weight",
  total_weight: "body_tyres_weight",
  weight_balance_front_percent: "body_tyres_weight",
  battery: "body_tyres_weight",

  // --- Other (kept, never dropped) ---
  driver: "other",
  setup_date: "other",
  track_surface: "other",
  track_layout: "other",
  traction: "other",
  notes: "other",
  body_notes: "other",
};

/** Universal parameter id -> group, so a car that reuses a canonical id inherits its home. */
const GROUP_BY_UNIVERSAL_ID: Record<string, SetupSheetGroupId> = (() => {
  const out: Record<string, SetupSheetGroupId> = {};
  for (const def of UNIVERSAL_TOURING_PARAMETERS) {
    const explicit = EXPLICIT_GROUP_BY_KEY[def.id];
    if (explicit) out[def.id] = explicit;
  }
  return out;
})();

/**
 * Heuristics for keys a calibration or the AI schema drafter invented ("rear_ride_ht",
 * "f_shock_oil"). Ordered: the most specific pattern must come first, because `spring_gap` and
 * `diff_height` would otherwise be caught by the bare `spring` / `height` tests.
 */
const HEURISTICS: Array<{ test: RegExp; group: SetupSheetGroupId }> = [
  { test: /shim|bump\s*steer|toe\s*gain|roll\s*cent/, group: "links_shims" },
  /**
   * Chassis before drivetrain, because the motor MOUNT is flex hardware (the A800 sheet prints its
   * screws under Flex) while the motor itself is driveline. Bare `motor` below would swallow it.
   */
  { test: /top\s*deck|chassis|bumper|brace|flex|c45|stiffener|motor\s*mount/, group: "chassis_flex" },
  // Electronics fold in here until a sheet carries enough of them to earn a group.
  { test: /diff|spool|belt|pulley|slipper|gear\s*ratio|fdr|spur|pinion|motor|esc\b|servo|timing/, group: "drivetrain" },
  { test: /spring\s*gap|spring|damper|shock|srs|pss|damping|anti\s*roll|sway\s*bar|roll\s*bar|arb/, group: "shocks_springs" },
  { test: /body|shell|wing|tyre|tire|weight|ballast|battery/, group: "body_tyres_weight" },
  {
    test: /camber|caster|castor|\btoe\b|ride\s*height|ride\s*ht|\brh\b|droop|downstop|down\s*stop|upstop|up\s*stop|steering\s*angle|ackermann/,
    group: "suspension_geometry",
  },
];

/**
 * Resolve a field's display group. Returns undefined only when nothing matches, so callers can
 * decide whether to bucket into "other" or leave a row where it was.
 */
export function groupForFieldKey(key: string, label?: string): SetupSheetGroupId | undefined {
  const k = key.trim();
  if (!k) return undefined;

  const explicit = EXPLICIT_GROUP_BY_KEY[k];
  if (explicit) return explicit;

  const canonical = canonicalAggregationParameterKey(k);
  const viaUniversal = GROUP_BY_UNIVERSAL_ID[canonical];
  if (viaUniversal) return viaUniversal;

  const haystack = `${k} ${label ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  for (const h of HEURISTICS) {
    if (h.test.test(haystack)) return h.group;
  }
  return undefined;
}

/** Every field key a structured row lays out, in display order. */
export function structuredRowFieldKeys(row: StructuredRow): string[] {
  switch (row.type) {
    case "single":
      return [row.key];
    case "pair":
      return [row.leftKey, row.rightKey];
    case "corner4":
      return [row.ff, row.fr, row.rf, row.rr];
    case "slots":
      return row.slots.map((s) => s.key).filter(Boolean);
    case "screw_strip":
      return [row.key];
    case "top_deck_block":
      // A bespoke render block with no field keys of its own; it is flex hardware by definition.
      return [];
    default:
      return [];
  }
}

/** The group a whole row belongs to — first key that resolves wins; all keys of a real row agree. */
export function groupForStructuredRow(row: StructuredRow): SetupSheetGroupId | undefined {
  if (row.type === "top_deck_block") return "chassis_flex";
  const label = "label" in row ? row.label : undefined;
  for (const key of structuredRowFieldKeys(row)) {
    const g = groupForFieldKey(key, label);
    if (g) return g;
  }
  return undefined;
}

/**
 * Re-bucket a car's structured layout into the universal groups, preserving row order within each.
 *
 * TOTAL BY CONTRACT: every input row appears exactly once in the output. A row whose keys resolve
 * to nothing lands in "Other" rather than being dropped — silently losing a row would hide a
 * driver's saved value, which is the one failure this must never have. `setupSheetGroups.test.ts`
 * asserts the invariant.
 *
 * Empty groups are omitted. Rendering all six headers with an "Add" stub for the missing ones is
 * the agreed design but needs a change in `SetupSheetStructured`, so it is not done here.
 */
export function regroupStructuredSections(sections: StructuredSection[]): StructuredSection[] {
  const byGroup = new Map<SetupSheetGroupId, StructuredRow[]>();
  for (const section of sections) {
    for (const row of section.rows) {
      const group = groupForStructuredRow(row) ?? "other";
      const bucket = byGroup.get(group);
      if (bucket) bucket.push(row);
      else byGroup.set(group, [row]);
    }
  }

  const out: StructuredSection[] = [];
  for (const group of SETUP_SHEET_GROUPS) {
    const rows = byGroup.get(group.id);
    if (!rows || rows.length === 0) continue;
    out.push({ id: group.id, title: group.title, rows });
  }
  return out;
}
