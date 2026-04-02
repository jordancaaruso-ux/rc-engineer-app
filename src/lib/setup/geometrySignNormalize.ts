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
