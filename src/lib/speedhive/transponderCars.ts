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

/**
 * The chip to pair with the car the driver just named on "which car?", or null. Their answer is
 * the fact: the runs it filed were found by this chip, so the chip is in that car and they are
 * not asked again (founder call 2026-09-17). Only when the answer covered exactly one chip — two
 * chips under one answer could be two cars — and never over a pairing to a car they still own.
 */
export function chipToPairWithNamedCar(input: {
  chips: readonly (string | null | undefined)[];
  map: TransponderCarMap;
  userCarIds: readonly string[];
}): string | null {
  const distinct = new Set(
    input.chips.map((c) => (c ? normalizeSpeedhiveTransponderNumber(c) : null)).filter((c): c is string => !!c),
  );
  if (distinct.size !== 1) return null;
  const chip = [...distinct][0]!;
  const paired = input.map[chip];
  if (paired && input.userCarIds.includes(paired)) return null;
  return chip;
}

export function formatTransponderCarsSetting(map: TransponderCarMap): string | null {
  const entries = Object.entries(map)
    .map(([k, v]) => [normalizeSpeedhiveTransponderNumber(k), v.trim()] as const)
    .filter((e): e is readonly [string, string] => Boolean(e[0]) && Boolean(e[1]));
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}
