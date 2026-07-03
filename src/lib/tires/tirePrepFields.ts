import { CALIBRATION_PAIR_GROUPS } from "@/lib/setupCalibrations/calibrationFieldCatalog";

/**
 * Boolean prep-product keys (ST205, AT15, …). These are setup-sheet parameters — the
 * Tires tab's "tire prep" is additive + warmer timing only, so no run-form UI reads
 * these groups anymore; the snapshot normalizer still coerces their stored values.
 */
export function allTirePrepBooleanKeys(): string[] {
  return CALIBRATION_PAIR_GROUPS.filter((g) => g.innerKind === "boolean").flatMap((g) => [
    g.frontKey,
    g.rearKey,
  ]);
}
