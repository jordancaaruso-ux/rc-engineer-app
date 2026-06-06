import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import {
  AWESOMATIX_MULTI_SELECT_GROUPS,
  AWESOMATIX_SINGLE_CHOICE_GROUPS,
} from "@/lib/setupDocuments/awesomatixWidgetGroups";
import type { SchemaParameterKind } from "@/lib/setupSheetModels/fieldParamTypes";

const AWESOMATIX_ONLY_KEYS = new Set([
  ...Object.keys(AWESOMATIX_SINGLE_CHOICE_GROUPS),
  ...Object.keys(AWESOMATIX_MULTI_SELECT_GROUPS),
]);

function formatOptionPreview(options: readonly string[], max = 4): string {
  const shown = options.slice(0, max).join(", ");
  return options.length > max ? `${shown}, …` : shown;
}

/**
 * Warn when a custom sheet model field key collides with Awesomatix A800 catalog keys.
 * Numeric/text fields on non-A800 cars should use distinct keys (e.g. spring_rate_front).
 */
export function awesomatixFieldKeyCollisionWarning(
  key: string,
  kind?: SchemaParameterKind
): string | null {
  const k = key.trim();
  if (!k || !AWESOMATIX_ONLY_KEYS.has(k)) return null;

  const single = AWESOMATIX_SINGLE_CHOICE_GROUPS[k];
  if (single) {
    if (kind === "one_of_many") return null;
    return `Key "${k}" is reserved for Awesomatix A800 (${formatOptionPreview(single)}). Use a different key for free-text or numeric fields, or link a universal parameter (e.g. spring_rate_front → spring_front).`;
  }

  const multi = AWESOMATIX_MULTI_SELECT_GROUPS[k];
  if (multi) {
    if (kind === "many_of_many") return null;
    return `Key "${k}" is reserved for Awesomatix A800 multi-select (${formatOptionPreview(multi)}). Pick a different key or set type to "Many of many" with matching options.`;
  }

  const catalogKind = getCalibrationFieldKind(k);
  if (catalogKind === "singleSelect" || catalogKind === "visualMulti") {
    return `Key "${k}" matches an Awesomatix A800 catalog field. Use a distinct key unless this sheet is calibrated for that PDF.`;
  }

  return null;
}
