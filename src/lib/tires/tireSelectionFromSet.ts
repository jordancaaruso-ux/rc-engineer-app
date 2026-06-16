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

export function tireSetDisplayLine(tireSet: TireSetForSelection): string {
  if (tireSet.tireType) {
    return displayTireSelection(
      buildTireSelectionValue({
        tireTypeId: tireSet.tireType.id,
        displayName: tireSet.tireType.displayName,
        specificModel: tireSet.specificModel,
        insert: tireSet.insertLabel,
        wheel: tireSet.wheelLabel,
      }),
      tireSet.setNumber
    );
  }
  return displayTireSelection(tireSet.label, tireSet.setNumber);
}
