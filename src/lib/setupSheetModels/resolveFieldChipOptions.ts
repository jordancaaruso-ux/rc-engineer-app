import {
  getCalibrationFieldKind,
  getSingleSelectChipOptions,
  getVisualMultiOptions,
} from "@/lib/setupCalibrations/calibrationFieldCatalog";
import type { SetupSheetFieldChipOptions } from "@/lib/setupSheetTemplate";

/**
 * Resolve chip / one-of-many UI options for a snapshot key.
 *
 * When `fieldChipOptionsByKey` is provided (setup sheet model schema), only stored
 * schema options apply — no Awesomatix/A800 catalog fallback by key name.
 * Legacy templates pass `null`/`undefined` and keep catalog fallback for A800 sheets.
 */
export function resolveFieldChipOptionsForKey(
  key: string,
  fieldChipOptionsByKey?: Record<string, SetupSheetFieldChipOptions> | null
): SetupSheetFieldChipOptions | null {
  if (fieldChipOptionsByKey != null) {
    const modelOpts = fieldChipOptionsByKey[key];
    if (modelOpts && modelOpts.options.length > 0) return modelOpts;
    return null;
  }

  const multi = getVisualMultiOptions(key);
  if (multi && multi.length > 0) return { options: multi, multi: true };
  const single = getSingleSelectChipOptions(key);
  if (single && single.length > 0) return { options: single, multi: false };
  const kind = getCalibrationFieldKind(key);
  if (kind === "boolean") return { options: ["yes", "no"], multi: false };
  return null;
}
