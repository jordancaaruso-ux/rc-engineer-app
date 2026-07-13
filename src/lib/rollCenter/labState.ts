/**
 * Roll Center Lab state — the geometry slice of a setup sheet as a flat
 * pseudo-snapshot, plus the URL codec that carries it into the Lab.
 *
 * The Lab deliberately works in SHEET VOCABULARY (the same field keys the
 * calculator reads), so a Lab state can seed from any sheet, diff against its
 * baseline in sheet terms, and export straight back into a run's setup form.
 * Keeping the codec dependency-free (plain JSON → base64url) lets both the
 * client Lab and the /runs/new server page decode it.
 */

/** Every sheet key the geometry calc consumes (see computeFromSnapshot.ts). */
export const GEOMETRY_SHEET_KEYS = [
  "under_lower_arm_shims_ff",
  "under_lower_arm_shims_fr",
  "under_lower_arm_shims_rf",
  "under_lower_arm_shims_rr",
  "upper_inner_shims_ff",
  "upper_inner_shims_fr",
  "upper_inner_shims_rf",
  "upper_inner_shims_rr",
  "under_hub_shims_front",
  "under_hub_shims_rear",
  "upper_outer_shims_front",
  "upper_outer_shims_rear",
  "ride_height_front",
  "ride_height_rear",
  "camber_front",
  "camber_rear",
  "wheel_spacer_front",
  "wheel_spacer_rear",
  "chassis",
] as const;

export type GeometrySheetKey = (typeof GEOMETRY_SHEET_KEYS)[number];

export type LabFields = Partial<Record<GeometrySheetKey, string>>;

/** Field-length cap shared by extract + decode (chassis choice objects can be long-ish). */
const MAX_FIELD_CHARS = 120;

/** A800 no-shim baseline — the Lab's blank-slate state (fingerprints the pack). */
export const LAB_DEFAULT_FIELDS: LabFields = {
  under_lower_arm_shims_ff: "0",
  under_lower_arm_shims_fr: "0",
  under_lower_arm_shims_rf: "0",
  under_lower_arm_shims_rr: "0",
  upper_inner_shims_ff: "0",
  upper_inner_shims_fr: "0",
  upper_inner_shims_rf: "0",
  upper_inner_shims_rr: "0",
  under_hub_shims_front: "0",
  under_hub_shims_rear: "0",
  upper_outer_shims_front: "0",
  upper_outer_shims_rear: "0",
  ride_height_front: "5.0",
  ride_height_rear: "5.2",
  chassis: "C01RS",
};

/** Pick the geometry slice out of a full setup snapshot, as display strings.
 * Non-string values (numbers, preset choice objects — e.g. chassis) are flattened
 * the same way the calculator's own parser flattens them, so codes survive. */
export function extractGeometryFields(data: Record<string, unknown>): LabFields {
  const out: LabFields = {};
  for (const key of GEOMETRY_SHEET_KEYS) {
    const v = data[key];
    if (v == null || v === "") continue;
    let s: string;
    if (typeof v === "string") s = v;
    else if (typeof v === "number" || typeof v === "boolean") s = String(v);
    else {
      try {
        s = JSON.stringify(v);
      } catch {
        continue;
      }
    }
    if (s) out[key] = s.slice(0, MAX_FIELD_CHARS);
  }
  return out;
}

/* ── URL codec ─────────────────────────────────────────────────────────────
 * base64url(JSON) — works in browser and node (the /runs/new page decodes
 * server-side). Unknown keys are dropped on decode, so a stale link can never
 * inject arbitrary fields. */

function toBase64Url(s: string): string {
  const b64 =
    typeof window === "undefined"
      ? Buffer.from(s, "utf8").toString("base64")
      : btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof window === "undefined") {
      return Buffer.from(b64, "base64").toString("utf8");
    }
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeLabFields(fields: LabFields): string {
  return toBase64Url(JSON.stringify(fields));
}

export function decodeLabFields(encoded: string): LabFields | null {
  const json = fromBase64Url(encoded);
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: LabFields = {};
    const allowed = new Set<string>(GEOMETRY_SHEET_KEYS);
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!allowed.has(k)) continue;
      if (typeof v !== "string" && typeof v !== "number") continue;
      out[k as GeometrySheetKey] = String(v).slice(0, MAX_FIELD_CHARS);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Sheet-vocabulary change list (Lab state vs its seeded baseline). */
export function labChangeList(current: LabFields, baseline: LabFields): string[] {
  const lines: string[] = [];
  for (const key of GEOMETRY_SHEET_KEYS) {
    const a = (baseline[key] ?? "").trim();
    const b = (current[key] ?? "").trim();
    if (a === b) continue;
    const label = key.replace(/_/g, " ");
    lines.push(`${label}: ${a === "" ? "—" : a} → ${b === "" ? "—" : b}`);
  }
  return lines;
}
