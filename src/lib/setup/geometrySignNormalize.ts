/**
 * Canonical sign conventions for geometry angles (degrees) stored in setup snapshots.
 * Applied during normalizeSetupSnapshotForStorage so imports, edits, and aggregations share one convention.
 */

import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";

const GEOMETRY_SIGN_RULE: Record<string, "neg" | "pos"> = {
  camber_front: "neg",
  camber_rear: "neg",
  toe_front: "neg",
  toe_rear: "pos",
  caster_front: "pos",
  caster_rear: "neg",
};

export function isGeometrySignCanonicalKey(key: string): boolean {
  return key in GEOMETRY_SIGN_RULE;
}

function parseNumericSetup(raw: unknown): number | null {
  return parseNumericFromSetupString(raw, { allowKSuffix: false });
}

/**
 * Returns normalized number for keys in GEOMETRY_SIGN_RULE, or undefined if key is not ruled or value is not parseable.
 */
export function canonicalGeometrySignedValue(key: string, raw: unknown): number | undefined {
  const rule = GEOMETRY_SIGN_RULE[key];
  if (!rule) return undefined;
  const n = parseNumericSetup(raw);
  if (n == null) return undefined;
  const mag = Math.abs(n);
  return rule === "neg" ? -mag : mag;
}

/**
 * The same angle as the manufacturer's paper prints it: unsigned.
 *
 * The sign above is the APP's, not the sheet's. Awesomatix, Xray and Mugen all print camber and toe
 * as bare magnitudes — the printed caption ("CAMBER°") and the picture of the car carry the
 * direction, so the number never needs one. The app adds a sign at import so that every stored angle
 * across every car compares and aggregates the same way, which is right for storage and wrong for
 * the paper: a driver who uploads a sheet reading 1.75 and downloads it again gets −1.75 back, on a
 * sheet that has never in its life printed a minus sign (founder call 2026-08-14).
 *
 * Only the six ruled keys are touched, and only the leading minus is removed — a value the app never
 * signed, or one that isn't a number at all, comes back untouched. Nothing is stored: this is the
 * last step before the value is written onto a PDF.
 */
export function unsignedGeometryValueForPaper(key: string, value: string): string {
  if (!isGeometrySignCanonicalKey(key)) return value;
  const stripped = value.trim().replace(/^[-−–—]\s*/, "");
  if (stripped === value.trim()) return value;
  // "-" alone, or "-tbd", would otherwise silently lose its first character.
  return parseNumericSetup(stripped) == null ? value : stripped;
}
