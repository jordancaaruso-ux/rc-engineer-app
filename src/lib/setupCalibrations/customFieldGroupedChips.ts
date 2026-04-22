import type { CustomSetupFieldDefinition } from "@/lib/setupCalibrations/types";
import { isSingleSelectGroupedBehavior } from "@/lib/setupCalibrations/types";

export type CustomGroupedChipEntry = { value: string; label: string };

/**
 * When a custom field has groupedOptions (2+), enable the same pick-chip → click-PDF
 * workflow as catalog Awesomatix fields. Returns null if this key is not a custom grouped field.
 */
export function customFieldGroupedChipContext(
  def: CustomSetupFieldDefinition | undefined
): { kind: "single" | "multi"; entries: CustomGroupedChipEntry[] } | null {
  if (!def?.groupedOptions || def.groupedOptions.length < 2) return null;
  const sorted = [...def.groupedOptions].sort((a, b) => a.order - b.order);
  const entries: CustomGroupedChipEntry[] = sorted.map((o) => ({
    value: o.optionValue,
    label: o.optionLabel?.trim() ? o.optionLabel : o.optionValue,
  }));
  const b = def.groupBehaviorType;

  if (def.uiType === "select") {
    if (b === "visualMulti" || b === "multiChoiceGroup") return null;
    if (!b || isSingleSelectGroupedBehavior(b)) {
      return { kind: "single", entries };
    }
  }
  if (def.uiType === "multiSelect") {
    if (b === "singleSelect" || b === "singleChoiceGroup") return null;
    if (!b || b === "visualMulti" || b === "multiChoiceGroup") {
      return { kind: "multi", entries };
    }
  }
  return null;
}
