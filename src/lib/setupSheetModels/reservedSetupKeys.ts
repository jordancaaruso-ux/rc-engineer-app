import {
  isPresetWithOtherCompanionKey,
  isPresetWithOtherFieldKey,
} from "@/lib/setup/presetWithOther";
import { isMultiSelectFieldKey } from "@/lib/setup/multiSelect";
import { isTireFieldKey } from "@/lib/tires/tireSelectionValue";
import { isGeometrySignCanonicalKey } from "@/lib/setup/geometrySignNormalize";
import { isRunContextSetupKey } from "@/lib/setup/runContextSetupKeys";

/**
 * Keys the app already gives a special meaning to, and which a PDF-derived box must therefore never
 * be allowed to claim.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * `normalizeSetupSnapshotForStorage` is the one write path for every saved setup, and for a handful
 * of keys it does not store what it was given — it rewrites it. That is correct for the sheets the
 * app authored, where the key really is the app's own concept with the app's own vocabulary. It is
 * wrong for a box on somebody's manufacturer blank that merely happens to spell the same word.
 *
 * What a driver would actually lose, per family:
 *
 *   `camber_front`   number is forced negative — they type 2.5, they get back -2.5
 *   `toe_rear`       forced positive, the same way round
 *   `chassis`        the string becomes { selectedPreset, otherText }, matched against the A800RR's
 *                    part-number chip list; anything that does not match lands in a stray free-text
 *                    slot instead of the box they filled
 *   `chassis_other`  dropped outright — the normaliser skips preset companion keys, so the value is
 *                    gone with no error
 *   `traction`       the string is split into a token array, so `"medium"` reads back as `["medium"]`
 *   `top_deck_screws` same, and tokens outside the known A/B/C…F list are filtered away
 *   `tires`          the string is parsed into a tire-selection object
 *   `additive`       stored intact, but permanently invisible to every "what changed" report, because
 *                    the run form owns those keys and picking today's tires is not a setup change
 *
 * The derivation cannot see any of this. It mints a key from the manufacturer's field name, and a
 * sheet with a box called "Camber front" is entirely ordinary.
 *
 * ============================== WHY A SUFFIX, NOT A MERGE ==============================
 *
 * The tempting fix is the opposite one: let the derived box BE `camber_front` so it lines up with
 * the rest of the app for free. That is the bug, not the fix. Lining up means inheriting the sign
 * rule, the chip list and the token vocabulary of a sheet this driver does not own, and none of
 * those are properties of their box — they are properties of the schema the app wrote.
 *
 * The supported way to say "this box is the front camber knob" is `universalParameterId`, set when a
 * human names the box. That is a label, it is reversible, and `resolveUniversalParameterId` reads it
 * for exactly this purpose. Key identity is not reversible, which is why it must not carry meaning
 * nobody has checked.
 *
 * The suffix is `__s`. `suggestKeyFromPdfFieldName` collapses every run of non-alphanumerics to a
 * SINGLE underscore, so a doubled underscore cannot come out of any field name — the same property
 * that makes `__b<n>` a safe split suffix. No reserved key contains one either, so suffixing can
 * never land on a second reserved key.
 */

/** Handled by name inside `normalizeSetupSnapshotForStorage`, not behind a predicate. */
const SCREW_KEYS = new Set(["motor_mount_screws", "top_deck_screws", "top_deck_cuts"]);

export const DERIVED_KEY_RESERVED_SUFFIX = "__s";

/** True when storing a value under this key would change it, or hide it from change reports. */
export function isReservedSetupKey(key: string): boolean {
  return (
    isPresetWithOtherFieldKey(key) ||
    isPresetWithOtherCompanionKey(key) ||
    SCREW_KEYS.has(key) ||
    isMultiSelectFieldKey(key) ||
    isTireFieldKey(key) ||
    isGeometrySignCanonicalKey(key) ||
    isRunContextSetupKey(key)
  );
}

/**
 * The key a derived box may safely keep. Unreserved names pass through untouched, so this changes
 * nothing on a sheet like the Xray X4 — measured 2026-08-10, it moves 1 key out of 201.
 *
 * Permanent output. Every call site freezes its result into run history the first time a driver
 * saves, so this must stay a pure function of the key alone.
 */
export function reservedSafeDerivedKey(key: string): string {
  return isReservedSetupKey(key) ? `${key}${DERIVED_KEY_RESERVED_SUFFIX}` : key;
}
