import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";

/**
 * "This transponder lives in this car." Most drivers mount one chip per car and leave it there,
 * so saying so once lets a run the timing sweep files carry a car without the app guessing.
 * Stored as a JSON object `{ "<chip code>": "<carId>" }` in one AppSetting.
 */
export type TransponderCarMap = Record<string, string>;

export function parseTransponderCarsSetting(raw: string | null | undefined): TransponderCarMap {
  const text = raw?.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TransponderCarMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const chip = normalizeSpeedhiveTransponderNumber(k);
      if (!chip || typeof v !== "string" || !v.trim()) continue;
      out[chip] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function formatTransponderCarsSetting(map: TransponderCarMap): string | null {
  const entries = Object.entries(map)
    .map(([k, v]) => [normalizeSpeedhiveTransponderNumber(k), v.trim()] as const)
    .filter((e): e is readonly [string, string] => Boolean(e[0]) && Boolean(e[1]));
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}
