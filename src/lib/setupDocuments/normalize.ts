import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";
import { getCalibrationFieldKind, getSingleSelectChipOptions } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { isMultiSelectFieldKey, normalizeMultiSelectValue } from "@/lib/setup/multiSelect";
import { rewriteImportedCalculatedDisplayKey } from "@/lib/setup/derivedFields";
import {
  isEmptyPresetWithOther,
  isPresetWithOtherFieldKey,
  normalizePresetWithOtherFromUnknown,
  scalarSetupTextFromUnknown,
} from "@/lib/setup/presetWithOther";

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** Prefer snake_case app keys everywhere (sanitizers, sheet UI, DB). */
export const CAMEL_TO_SNAKE_KEY_MAP: Record<string, string> = {
  upperInnerShimsFF: "upper_inner_shims_ff",
  upperInnerShimsFR: "upper_inner_shims_fr",
  upperInnerShimsRF: "upper_inner_shims_rf",
  upperInnerShimsRR: "upper_inner_shims_rr",
  upperOuterShimsFront: "upper_outer_shims_front",
  upperOuterShimsRear: "upper_outer_shims_rear",
  bumpSteerShimsFront: "bump_steer_shims_front",
  toeGainShimsRear: "toe_gain_shims_rear",
  underHubShimsFront: "under_hub_shims_front",
  underHubShimsRear: "under_hub_shims_rear",
  underLowerArmShimsFF: "under_lower_arm_shims_ff",
  underLowerArmShimsFR: "under_lower_arm_shims_fr",
  underLowerArmShimsRF: "under_lower_arm_shims_rf",
  underLowerArmShimsRR: "under_lower_arm_shims_rr",
  camberFront: "camber_front",
  camberRear: "camber_rear",
  casterFront: "caster_front",
  casterRear: "caster_rear",
  toeFront: "toe_front",
  toeRear: "toe_rear",
  rideHeightFront: "ride_height_front",
  rideHeightRear: "ride_height_rear",
  downstopFront: "downstop_front",
  downstopRear: "downstop_rear",
  upstopFront: "upstop_front",
  upstopRear: "upstop_rear",
  arbFront: "arb_front",
  arbRear: "arb_rear",
  diffPositionFront: "diff_position_front",
  diffPositionRear: "diff_position_rear",
  diffOil: "diff_oil",
  diffShims: "diff_shims",
  diffHeight: "diff_height",
  trackLayout: "track_layout",
  trackGrip: "traction",
  trackSurface: "track_surface",
  frontBodyPostOring: "front_body_post_oring",
  wheelSpacer: "wheel_spacer",
  wheelSpacerFront: "wheel_spacer_front",
  wheelSpacerRear: "wheel_spacer_rear",
  at15Front: "at15_front",
  at15Rear: "at15_rear",
  at13wFront: "at13w_front",
  at13wRear: "at13w_rear",
  diffHeightFront: "diff_height_front",
  diffHeightRear: "diff_height_rear",
  damperOilFront: "damper_oil_front",
  damperOilRear: "damper_oil_rear",
  springGapFront: "spring_gap_front",
  springGapRear: "spring_gap_rear",
  damperPercentFront: "damper_percent_front",
  damperPercentRear: "damper_percent_rear",
  pssPercentSetupFront: "pss_percent_setup_front",
  pssPercentSetupRear: "pss_percent_setup_rear",
  springFront: "spring_front",
  springRear: "spring_rear",
  srsArrangementFront: "srs_arrangement_front",
  srsArrangementRear: "srs_arrangement_rear",
  dampingFront: "damping_front",
  dampingRear: "damping_rear",
  c45InstalledFront: "c45_installed_front",
  c45InstalledRear: "c45_installed_rear",
  weightBalanceFrontPercent: "weight_balance_front_percent",
  totalWeight: "total_weight",
  bodyshell: "bodyshell",
  wing: "wing",
  innerSteeringAngle: "inner_steering_angle",
  battery: "battery",
  tires: "tires",
  chassis: "chassis",
  chassisOther: "chassis_other",
  topDeckFront: "top_deck_front",
  topDeckFrontOther: "top_deck_front_other",
  topDeckRear: "top_deck_rear",
  topDeckRearOther: "top_deck_rear_other",
  topDeckSingle: "top_deck_single",
  topDeckSingleOther: "top_deck_single_other",
  frontBumperOther: "front_bumper_other",
  motorMountScrews: "motor_mount_screws",
  topDeckScrews: "top_deck_screws",
  topDeckCuts: "top_deck_cuts",
  frontSpringRateGfMm: "front_spring_rate_gf_mm",
  rearSpringRateGfMm: "rear_spring_rate_gf_mm",
  finalDriveRatio: "final_drive_ratio",
};

/** Map calibration / importer keys to canonical snake_case field names. */
export function canonicalSetupFieldKey(k: string): string {
  return CAMEL_TO_SNAKE_KEY_MAP[k] ?? k;
}

function camelToSnakeKey(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function normalizeParsedSetupData(input: unknown): SetupSnapshotData {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const out: SetupSnapshotData = {};
  for (const [k, v] of Object.entries(obj)) {
    const mapped = CAMEL_TO_SNAKE_KEY_MAP[k];
    const rawTargetKey = mapped ?? (/[A-Z]/.test(k) ? camelToSnakeKey(k) : k);
    const targetKey = rewriteImportedCalculatedDisplayKey(rawTargetKey);
    if (v == null) continue;
    const kind = getCalibrationFieldKind(targetKey);
    const multi = isMultiSelectFieldKey(targetKey) || kind === "visualMulti";
    if (Array.isArray(v)) {
      const arr = normalizeMultiSelectValue(targetKey, v);
      if (multi) out[targetKey] = arr;
      else if (arr.length > 0) out[targetKey] = arr.join(", ");
      continue;
    }
    if (isPlainObject(v) && (isPresetWithOtherFieldKey(targetKey) || "selectedPreset" in v || "otherText" in v)) {
      const opts = getSingleSelectChipOptions(targetKey);
      const merged = normalizePresetWithOtherFromUnknown(
        v,
        undefined,
        isPresetWithOtherFieldKey(targetKey) ? opts : null
      );
      if (!isEmptyPresetWithOther(merged)) out[targetKey] = merged;
      continue;
    }
    if (isPlainObject(v)) {
      const extracted = scalarSetupTextFromUnknown(v).trim();
      if (extracted) {
        if (multi) out[targetKey] = normalizeMultiSelectValue(targetKey, extracted);
        else out[targetKey] = extracted;
      }
      continue;
    }
    const asString = typeof v === "string" ? v : String(v);
    if (multi) {
      out[targetKey] = normalizeMultiSelectValue(targetKey, asString);
      continue;
    }
    out[targetKey] = asString;
  }
  return normalizeSetupSnapshotForStorage(out);
}

export function mappedFieldKeys(data: SetupSnapshotData): string[] {
  return Object.keys(data).filter((k) => {
    const v = data[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (isPlainObject(v) && ("selectedPreset" in v || "otherText" in v)) {
      const merged = normalizePresetWithOtherFromUnknown(v, undefined, null);
      return !isEmptyPresetWithOther(merged);
    }
    return String(v).trim() !== "";
  });
}

