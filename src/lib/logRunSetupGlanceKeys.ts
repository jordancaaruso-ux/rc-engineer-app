import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";

/**
 * Keys shown in the collapsed “first glance” setup on Log your run:
 * the standard tuning-compare set plus drivetrain / roll-bar fields drivers tune often.
 */
export function isLogRunSetupGlanceKey(key: string): boolean {
  return isTuningComparisonKey(key) || key === "pinion" || key === "spur" || key === "rear_hrb_setting";
}
