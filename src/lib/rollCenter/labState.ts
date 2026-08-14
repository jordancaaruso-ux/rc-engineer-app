/**
 * Geometry Lab state — the geometry slice of a setup sheet as a flat
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

/** Pull the geometry slice out of an already-parsed JSON object, allowlisted. */
function fieldsFromObject(parsed: Record<string, unknown>): LabFields {
  const out: LabFields = {};
  const allowed = new Set<string>(GEOMETRY_SHEET_KEYS);
  for (const [k, v] of Object.entries(parsed)) {
    if (!allowed.has(k)) continue;
    if (typeof v !== "string" && typeof v !== "number") continue;
    out[k as GeometrySheetKey] = String(v).slice(0, MAX_FIELD_CHARS);
  }
  return out;
}

export function decodeLabFields(encoded: string): LabFields | null {
  const slot = decodeLabSlot(encoded);
  return slot && Object.keys(slot.fields).length > 0 ? slot.fields : null;
}

/* ── Slot seeds: the geometry slice, plus where it came from ───────────────
 *
 * The Lab used to be a pure URL state — the geometry slice and nothing else — because a shared link
 * has no car context and no session. That is still true of the slice, and still what makes a link
 * work for anyone. What it could never do is draw the sheet: a page picture and a box plan are both
 * keyed by chassis, and a save has to know which row it is allowed to touch.
 *
 * So a seed now optionally carries two REFERENCES — never data. `setupSheetModelId` says which
 * chassis to draw; `source` says which snapshot the values came from, so the Lab can fetch the other
 * ~260 boxes it does not carry and can work out whether that row is writable. Both are ids the
 * viewer's own session is re-checked against server-side; neither grants access to anything.
 *
 * Wire shape is `{ f, m, s }` so it can be told apart from the old bare `{ fieldKey: value }` blob.
 * Old links keep working — they decode as fields with no source, which is exactly what they are.
 */

export type LabSource = { kind: "run" | "setup"; id: string };

export type LabSlotSeed = {
  fields: LabFields;
  /** `Car.setupSheetModelId` — the chassis whose sheet this setup draws on. */
  setupSheetModelId: string | null;
  /** Which stored row these values came from, when they came from one at all. */
  source: LabSource | null;
};

/** Ids are cuids; cap and charset-check them so a hand-edited link can't smuggle a path. */
const MAX_ID_CHARS = 40;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function cleanId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.slice(0, MAX_ID_CHARS);
  return ID_RE.test(s) ? s : null;
}

export function encodeLabSlot(seed: LabSlotSeed): string {
  const payload: Record<string, unknown> = { f: seed.fields };
  if (seed.setupSheetModelId) payload.m = seed.setupSheetModelId;
  if (seed.source) payload.s = { k: seed.source.kind, i: seed.source.id };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeLabSlot(encoded: string): LabSlotSeed | null {
  const json = fromBase64Url(encoded);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  // Old shape: the object IS the fields. No `f`, so nothing else can be present either.
  if (!isJsonObject(obj.f)) {
    const fields = fieldsFromObject(obj);
    return Object.keys(fields).length > 0
      ? { fields, setupSheetModelId: null, source: null }
      : null;
  }

  const fields = fieldsFromObject(obj.f);
  const setupSheetModelId = cleanId(obj.m);
  let source: LabSource | null = null;
  if (isJsonObject(obj.s)) {
    const id = cleanId(obj.s.i);
    const kind = obj.s.k;
    if (id && (kind === "run" || kind === "setup")) source = { kind, id };
  }
  // A seed carrying only a reference is still a seed — the full values arrive from the fetch.
  return Object.keys(fields).length > 0 || setupSheetModelId || source
    ? { fields, setupSheetModelId, source }
    : null;
}

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
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
