import "server-only";

export type EngineerSetupDiffRow = {
  key: string;
  label: string;
  primary: string;
  compare: string;
};

const PAIR_TO_MERGED_LABEL = new Map<string, { partner: string; mergedLabel: string }>([
  [
    "upper_inner_shims_ff",
    {
      partner: "upper_inner_shims_fr",
      mergedLabel: "Upper inner shims — front axle, both bulkhead pickups (FF & FR)",
    },
  ],
  [
    "upper_inner_shims_fr",
    {
      partner: "upper_inner_shims_ff",
      mergedLabel: "Upper inner shims — front axle, both bulkhead pickups (FF & FR)",
    },
  ],
  [
    "under_lower_arm_shims_ff",
    {
      partner: "under_lower_arm_shims_fr",
      mergedLabel: "Under lower arm shims — front axle, both bulkhead pickups (FF & FR)",
    },
  ],
  [
    "under_lower_arm_shims_fr",
    {
      partner: "under_lower_arm_shims_ff",
      mergedLabel: "Under lower arm shims — front axle, both bulkhead pickups (FF & FR)",
    },
  ],
  [
    "upper_inner_shims_rf",
    {
      partner: "upper_inner_shims_rr",
      mergedLabel: "Upper inner shims — rear axle, both bulkhead pickups (RF & RR)",
    },
  ],
  [
    "upper_inner_shims_rr",
    {
      partner: "upper_inner_shims_rf",
      mergedLabel: "Upper inner shims — rear axle, both bulkhead pickups (RF & RR)",
    },
  ],
  [
    "under_lower_arm_shims_rf",
    {
      partner: "under_lower_arm_shims_rr",
      mergedLabel: "Under lower arm shims — rear axle, both bulkhead pickups (RF & RR)",
    },
  ],
  [
    "under_lower_arm_shims_rr",
    {
      partner: "under_lower_arm_shims_rf",
      mergedLabel: "Under lower arm shims — rear axle, both bulkhead pickups (RF & RR)",
    },
  ],
]);

/**
 * When both bulkhead pickups on an axle (FF & FR or RF & RR) show the same primary and compare values, show one row
 * for that axle instead of two. If only one pickup differs, keep both rows.
 * Order matches the input array (first occurrence drives the merged row position).
 */
export function collapseSetupDiffRowsForEngineer(rows: EngineerSetupDiffRow[]): EngineerSetupDiffRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const used = new Set<string>();
  const out: EngineerSetupDiffRow[] = [];

  for (const r of rows) {
    if (used.has(r.key)) continue;
    const pair = PAIR_TO_MERGED_LABEL.get(r.key);
    if (!pair) {
      out.push(r);
      continue;
    }
    const other = byKey.get(pair.partner);
    if (!other || used.has(pair.partner)) {
      out.push(r);
      continue;
    }
    if (r.primary === other.primary && r.compare === other.compare) {
      used.add(r.key);
      used.add(pair.partner);
      out.push({
        key: r.key,
        label: pair.mergedLabel,
        primary: r.primary,
        compare: r.compare,
      });
    } else {
      out.push(r);
    }
  }

  return out;
}

/** Shown once in setupComparison so the model does not misinterpret abbreviations. */
export const SETUP_COMPARE_CORNER_KEY_LEGEND =
  "Setup keys FF / FR / RF / RR name the two chassis-side inner pickup stacks on each axle (forward vs rearward along the bulkhead), not left vs right wheels. " +
  "Inner pickup split on an axle = difference between those two stacks (e.g. FF−FR mm), which steers link/arm angle along the car—combine with outer shims and vehicleDynamicsKb for net geometry.";
