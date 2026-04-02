import { AWESOMATIX_MULTI_SELECT_GROUPS } from "@/lib/setupDocuments/awesomatixWidgetGroups";

const LEGACY_MULTI_KEYS = new Set<string>(["trackLayout", "trackGrip"]);
const CANONICAL_MULTI_KEYS = new Set<string>([
  "motor_mount_screws",
  "top_deck_screws",
  "top_deck_cuts",
  "track_layout",
  "traction",
]);

function canonicalMultiKey(key: string): string {
  if (key === "trackLayout") return "track_layout";
  if (key === "trackGrip") return "traction";
  return key;
}

export function isMultiSelectFieldKey(key: string): boolean {
  const k = canonicalMultiKey(key);
  return CANONICAL_MULTI_KEYS.has(k) || k in AWESOMATIX_MULTI_SELECT_GROUPS || LEGACY_MULTI_KEYS.has(key);
}

function splitMultiTokens(raw: string): string[] {
  return raw
    .split(/[,;/+|]|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeMultiSelectValue(key: string, raw: unknown): string[] {
  const canonicalKey = canonicalMultiKey(key);
  const knownOrder = AWESOMATIX_MULTI_SELECT_GROUPS[canonicalKey] ?? [];
  const source = Array.isArray(raw)
    ? raw.map((v) => String(v))
    : raw == null
      ? []
      : splitMultiTokens(String(raw));

  const seen = new Set<string>();
  const deduped = source
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => {
      const token = v.toLowerCase();
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });

  if (!knownOrder.length) return deduped;

  const orderMap = new Map(knownOrder.map((v, idx) => [v.toLowerCase(), idx]));
  return [...deduped].sort((a, b) => {
    const ia = orderMap.get(a.toLowerCase());
    const ib = orderMap.get(b.toLowerCase());
    if (ia == null && ib == null) return a.localeCompare(b);
    if (ia == null) return 1;
    if (ib == null) return -1;
    return ia - ib;
  });
}

export function multiSelectSetEquals(key: string, a: unknown, b: unknown): boolean {
  const aa = normalizeMultiSelectValue(key, a);
  const bb = normalizeMultiSelectValue(key, b);
  if (aa.length !== bb.length) return false;
  const bSet = new Set(bb.map((v) => v.toLowerCase()));
  return aa.every((v) => bSet.has(v.toLowerCase()));
}
