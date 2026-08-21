import { isMultiSelectFieldKey } from "@/lib/setup/multiSelect";
import { isPresetWithOtherFieldKey } from "@/lib/setup/presetWithOther";
import { isTireFieldKey } from "@/lib/tires/tireSelectionValue";

/**
 * Which setup fields may be retyped into a text box on the run page.
 *
 * ============================== WHY MOST CAN AND SOME CANNOT ==============================
 *
 * A ride height is a number and a spring is a rate: typing over them is exactly
 * what a correction is. But four kinds of setup value are not text at all, even
 * though they RENDER as text:
 *
 *  - screw patterns (`motor_mount_screws`, `top_deck_screws`, `top_deck_cuts`) are
 *    string arrays, shown joined with commas. Saving the display string back would
 *    store `"1, 3, 5"` where a `["1","3","5"]` belongs.
 *  - multi-selects are the same shape for the same reason.
 *  - preset-plus-other fields carry a chosen option AND a free-text override in one
 *    object; flattening them to their display string loses which half was which.
 *  - the `tires` value is a structured selection stamped from the run's own tire
 *    context, not a setup box — correcting it there would be immediately overwritten
 *    by the next run save.
 *
 * Those keep their real controls on the setup sheet editor, which is one tap away.
 * This predicate is the guard on both the surfaces that offer inline editing and on
 * the route that writes it — the client is an affordance, not a guarantee.
 */

const SCREW_KEYS = new Set(["motor_mount_screws", "top_deck_screws", "top_deck_cuts"]);

export function setupKeyIsInlineEditable(key: string): boolean {
  if (SCREW_KEYS.has(key)) return false;
  if (isMultiSelectFieldKey(key)) return false;
  if (isPresetWithOtherFieldKey(key)) return false;
  if (isTireFieldKey(key)) return false;
  return true;
}

/**
 * The value as well as the key — a key with no rule against it can still be holding
 * an object or an array on an older run, and that is just as unsafe to flatten.
 */
export function setupValueIsInlineEditable(key: string, value: unknown): boolean {
  if (!setupKeyIsInlineEditable(key)) return false;
  if (value == null) return true;
  return typeof value === "string" || typeof value === "number";
}
