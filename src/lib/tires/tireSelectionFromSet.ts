import {
  buildTireSelectionValue,
  displayTireSelection,
  type TireSelectionValue,
} from "@/lib/tires/tireSelectionValue";

export type TireSetForSelection = {
  label: string;
  setNumber?: number | null;
  insertLabel?: string | null;
  wheelLabel?: string | null;
  specificModel?: string | null;
  tireTypeId?: string | null;
  tireType?: { id: string; displayName: string; modelCode: string } | null;
};

/** Build canonical snapshot `tires` value from a tire set row. */
export function tireSelectionFromTireSet(tireSet: TireSetForSelection): TireSelectionValue | string {
  if (tireSet.tireType?.id) {
    return buildTireSelectionValue({
      tireTypeId: tireSet.tireType.id,
      displayName: tireSet.tireType.displayName,
      specificModel: tireSet.specificModel,
      insert: tireSet.insertLabel,
      wheel: tireSet.wheelLabel,
    });
  }
  const legacy = displayTireSelection(tireSet.label, tireSet.setNumber);
  return legacy;
}

/**
 * Inventory display line for a set. Wear-first identity lives in the add-run picker
 * (run count + session chain); here `setNumber` remains only as a legacy disambiguator
 * for list surfaces (assets hub) that don't load per-set aggregates.
 */
export function tireSetDisplayLine(tireSet: TireSetForSelection): string {
  const base = tireSet.tireType
    ? displayTireSelection(
        buildTireSelectionValue({
          tireTypeId: tireSet.tireType.id,
          displayName: tireSet.tireType.displayName,
          specificModel: tireSet.specificModel,
          insert: tireSet.insertLabel,
          wheel: tireSet.wheelLabel,
        })
      )
    : displayTireSelection(tireSet.label);
  const suffix =
    tireSet.setNumber != null && tireSet.setNumber >= 1 ? `Set ${tireSet.setNumber}` : "";
  return suffix ? `${base} · ${suffix}` : base;
}
