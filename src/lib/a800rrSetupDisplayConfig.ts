/**
 * A800RR structured setup sheet: sections, row layouts, and field keys (snake_case JSON).
 * Labels are for UI only; keys match SetupSnapshotData.
 */

export type SetupFieldKind = "text" | "bool" | "multi";

export type StructuredRow =
  | {
      type: "single";
      key: string;
      label: string;
      unit?: string;
      fieldKind?: SetupFieldKind;
      multiline?: boolean;
    }
  | {
      type: "pair";
      leftKey: string;
      rightKey: string;
      label: string;
      unit?: string;
      fieldKind?: SetupFieldKind;
    }
  | {
      type: "corner4";
      ff: string;
      fr: string;
      rf: string;
      rr: string;
      label: string;
      unit?: string;
      fieldKind?: SetupFieldKind;
    }
  | { type: "top_deck_block" }
  | {
      type: "screw_strip";
      key: "motor_mount_screws" | "top_deck_screws" | "top_deck_cuts";
      label: string;
    };

export type StructuredSection = {
  id: string;
  title: string;
  rows: StructuredRow[];
};

export const A800RR_STRUCTURED_SECTIONS: StructuredSection[] = [
  {
    id: "geometry_suspension",
    title: "Geometry / shims / suspension",
    rows: [
      {
        type: "corner4",
        label: "Upper inner shims",
        ff: "upper_inner_shims_ff",
        fr: "upper_inner_shims_fr",
        rf: "upper_inner_shims_rf",
        rr: "upper_inner_shims_rr",
      },
      {
        type: "corner4",
        label: "Under lower arm shims",
        ff: "under_lower_arm_shims_ff",
        fr: "under_lower_arm_shims_fr",
        rf: "under_lower_arm_shims_rf",
        rr: "under_lower_arm_shims_rr",
      },
      {
        type: "pair",
        label: "Upper outer shims",
        leftKey: "upper_outer_shims_front",
        rightKey: "upper_outer_shims_rear",
      },
      { type: "single", key: "bump_steer_shims_front", label: "Bump steer shims" },
      { type: "single", key: "toe_gain_shims_rear", label: "Toe gain shims" },
      {
        type: "pair",
        label: "Under hub shims",
        leftKey: "under_hub_shims_front",
        rightKey: "under_hub_shims_rear",
      },
      {
        type: "pair",
        label: "Camber",
        leftKey: "camber_front",
        rightKey: "camber_rear",
        unit: "°",
      },
      {
        type: "pair",
        label: "Caster",
        leftKey: "caster_front",
        rightKey: "caster_rear",
        unit: "°",
      },
      {
        type: "pair",
        label: "Toe",
        leftKey: "toe_front",
        rightKey: "toe_rear",
        unit: "°",
      },
      {
        type: "pair",
        label: "Ride height",
        leftKey: "ride_height_front",
        rightKey: "ride_height_rear",
        unit: "mm",
      },
      {
        type: "pair",
        label: "Downstop",
        leftKey: "downstop_front",
        rightKey: "downstop_rear",
        unit: "mm",
      },
      {
        type: "pair",
        label: "Upstop",
        leftKey: "upstop_front",
        rightKey: "upstop_rear",
        unit: "mm",
      },
      {
        type: "pair",
        label: "ARB",
        leftKey: "arb_front",
        rightKey: "arb_rear",
      },
      {
        type: "pair",
        label: "Diff height",
        leftKey: "diff_height_front",
        rightKey: "diff_height_rear",
      },
    ],
  },
  {
    id: "diff_drivetrain",
    title: "Diff / drivetrain",
    rows: [
      { type: "single", key: "diff_oil", label: "Diff oil", unit: "cSt" },
      { type: "single", key: "diff_shims", label: "Diff shims" },
    ],
  },
  {
    id: "dampers_srs",
    title: "Dampers / springs / SRS",
    rows: [
      {
        type: "pair",
        label: "Damper oil",
        leftKey: "damper_oil_front",
        rightKey: "damper_oil_rear",
        unit: "cSt",
      },
      {
        type: "pair",
        label: "Spring gap",
        leftKey: "spring_gap_front",
        rightKey: "spring_gap_rear",
        unit: "mm",
      },
      {
        type: "pair",
        label: "Spring rate",
        leftKey: "front_spring_rate_gf_mm",
        rightKey: "rear_spring_rate_gf_mm",
        unit: "gf/mm",
      },
      {
        type: "pair",
        label: "Damper %",
        leftKey: "damper_percent_front",
        rightKey: "damper_percent_rear",
        unit: "%",
      },
      {
        type: "pair",
        label: "PSS % setup",
        leftKey: "pss_percent_setup_front",
        rightKey: "pss_percent_setup_rear",
      },
      {
        type: "pair",
        label: "Spring",
        leftKey: "spring_front",
        rightKey: "spring_rear",
      },
      {
        type: "pair",
        label: "SRS arrangement",
        leftKey: "srs_arrangement_front",
        rightKey: "srs_arrangement_rear",
      },
      {
        type: "pair",
        label: "Damping",
        leftKey: "damping_front",
        rightKey: "damping_rear",
      },
    ],
  },
  {
    id: "general",
    title: "General / car-wide",
    rows: [
      {
        type: "single",
        key: "weight_balance_front_percent",
        label: "Weight balance F%",
        unit: "%",
      },
      { type: "single", key: "total_weight", label: "Total weight", unit: "g" },
      { type: "single", key: "bodyshell", label: "Bodyshell" },
      { type: "single", key: "wing", label: "Wing" },
      { type: "single", key: "inner_steering_angle", label: "Inner steering angle" },
      { type: "single", key: "battery", label: "Battery" },
      { type: "single", key: "tires", label: "Tires" },
      { type: "single", key: "chassis", label: "Chassis" },
      { type: "single", key: "front_bumper", label: "Front bumper" },
    ],
  },
  {
    id: "flex",
    title: "Flex",
    rows: [
      {
        type: "pair",
        label: "C45 installed",
        leftKey: "c45_installed_front",
        rightKey: "c45_installed_rear",
        fieldKind: "bool",
      },
      {
        type: "pair",
        label: "Top deck",
        leftKey: "top_deck_front",
        rightKey: "top_deck_rear",
      },
      { type: "screw_strip", key: "top_deck_screws", label: "Top deck screws" },
      { type: "screw_strip", key: "motor_mount_screws", label: "Motor mount screws" },
      { type: "screw_strip", key: "top_deck_cuts", label: "Top deck cuts" },
      { type: "single", key: "top_deck_single", label: "Top deck · Single" },
    ],
  },
  {
    id: "notes_legacy",
    title: "Notes",
    rows: [
      { type: "single", key: "notes", label: "Setup notes", multiline: true },
      { type: "single", key: "tires_setup", label: "Tire notes", multiline: true },
    ],
  },
];

/** Collect every canonical key from structured layout (for diff catalog / checkbox sets). */
export function collectStructuredFieldKeys(sections: StructuredSection[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => {
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };
  for (const sec of sections) {
    for (const row of sec.rows) {
      if (row.type === "single") add(row.key);
      else if (row.type === "pair") {
        add(row.leftKey);
        add(row.rightKey);
      } else if (row.type === "corner4") {
        add(row.ff);
        add(row.fr);
        add(row.rf);
        add(row.rr);
      } else if (row.type === "top_deck_block") {
        add("top_deck_front");
        add("top_deck_rear");
        add("top_deck_cuts");
        add("top_deck_single");
      } else if (row.type === "screw_strip") {
        add(row.key);
      }
    }
  }
  return keys;
}
