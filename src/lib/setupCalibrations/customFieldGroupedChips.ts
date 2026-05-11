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
  if (def.uiType === "multiSelect") {
    return { kind: "multi", entries };
  }
  if (def.uiType === "select") {
    if (def.groupBehaviorType === "visualMulti" || def.groupBehaviorType === "multiChoiceGroup") {
      return { kind: "multi", entries };
    }
    if (!def.groupBehaviorType || isSingleSelectGroupedBehavior(def.groupBehaviorType)) {
      return { kind: "single", entries };
    }
  }
  return null;
}
