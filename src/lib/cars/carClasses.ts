/**
 * Race classes / disciplines a car can belong to (founder interview
 * 2026-07-17). Curated ids stored on `Car.carClass` (nullable — unspecified is
 * fine and treated as "same class" everywhere it matters).
 *
 * Why this exists: the log-run wizard's car-swap rule. Switching cars keeps
 * the day context (event/track/session/laps/notes always); tires + prep carry
 * only between SAME-class cars (the same wheels bolt on), while a
 * different-class swap re-derives them from the new car's own last run. Setup
 * is always car-specific and swaps regardless.
 */

export type CarClassOption = { id: string; label: string };

export const CAR_CLASSES: readonly CarClassOption[] = [
  { id: "touring", label: "Touring car" },
  { id: "formula", label: "Formula (F1)" },
  { id: "pan-12th", label: "1/12th pan car" },
  { id: "gt", label: "GT / world GT" },
  { id: "m-chassis", label: "M-chassis / mini" },
  { id: "buggy-2wd", label: "1/10 buggy 2WD" },
  { id: "buggy-4wd", label: "1/10 buggy 4WD" },
  { id: "stadium-truck", label: "Stadium truck" },
  { id: "short-course", label: "Short course" },
  { id: "buggy-8th", label: "1/8 buggy" },
  { id: "truggy", label: "Truggy" },
  { id: "rally", label: "Rally" },
  { id: "crawler", label: "Crawler / trail" },
  { id: "other", label: "Other" },
] as const;

export function carClassLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return CAR_CLASSES.find((c) => c.id === id)?.label ?? id;
}

/**
 * Same-class check for the car-swap rule. Unknown (null) on either side counts
 * as SAME class — the safe default: a garage that never sets classes keeps
 * today's behavior (tires/prep carry across swaps).
 */
export function isSameCarClass(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return true;
  return a === b;
}
