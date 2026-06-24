import { CALIBRATION_PAIR_GROUPS } from "@/lib/setupCalibrations/calibrationFieldCatalog";

export type TirePrepGroup = {
  id: string;
  label: string;
  frontKey: string;
  rearKey: string;
};

/** Boolean prep-product pairs (ST205, AT15, …) present on the active setup sheet. */
export function tirePrepGroupsForSheetKeys(sheetKeys: Set<string>): TirePrepGroup[] {
  return CALIBRATION_PAIR_GROUPS.filter(
    (g) => g.innerKind === "boolean" && (sheetKeys.has(g.frontKey) || sheetKeys.has(g.rearKey))
  ).map(({ id, label, frontKey, rearKey }) => ({ id, label, frontKey, rearKey }));
}

export function allTirePrepBooleanKeys(): string[] {
  return CALIBRATION_PAIR_GROUPS.filter((g) => g.innerKind === "boolean").flatMap((g) => [
    g.frontKey,
    g.rearKey,
  ]);
}
