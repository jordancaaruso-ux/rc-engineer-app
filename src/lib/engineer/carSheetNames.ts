/**
 * A driver's own names for boxes on their car's sheet that the app cannot read yet.
 *
 * Founder, 2026-09-25: a driver's name for a box goes on "their car at once, offered to the chassis
 * after his OK". So a name is saved against the CAR — one driver, one car — and never against the
 * chassis, which every driver racing that model shares: an unchecked name there would reach people
 * who never typed it. Offering them to the chassis is a later step, behind the founder's review.
 *
 * Stored on `Car.sheetBoxNamesJson` as `{ "<box key>": { "name": "front roll bar", "at": "<ISO>" } }`.
 * The date is kept so a later review can tell a name typed once from one confirmed many times.
 */

export type CarSheetNamesJson = Record<string, { name: string; at: string }>;

/** A name is a few words ("front roll bar"); anything longer is a sentence typed in the wrong box. */
export const CAR_SHEET_NAME_MAX_CHARS = 60;

/** How many names one save may carry — a run where more moved than this is not a setup change. */
export const CAR_SHEET_NAMES_MAX_PER_SAVE = 60;

/** The names as `{ key: name }`, read defensively — the column is JSON the page could have written. */
export function readCarSheetNames(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = value && typeof value === "object" ? (value as { name?: unknown }).name : null;
    if (typeof name === "string" && name.trim()) out[key] = name.trim();
  }
  return out;
}

/** One name as saved: trimmed, spaces collapsed, capped. Empty means "forget this box's name". */
export function cleanCarSheetName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, CAR_SHEET_NAME_MAX_CHARS);
}

/**
 * The stored names with `updates` applied: a name sets or replaces that box's, an empty one removes
 * it, and every box not mentioned keeps what it had.
 */
export function mergeCarSheetNames(
  raw: unknown,
  updates: Readonly<Record<string, string>>,
  nowIso: string
): CarSheetNamesJson {
  const out: CarSheetNamesJson = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const v = value as { name?: unknown; at?: unknown } | null;
      if (v && typeof v.name === "string" && v.name.trim()) {
        out[key] = { name: v.name.trim(), at: typeof v.at === "string" ? v.at : nowIso };
      }
    }
  }
  for (const [key, name] of Object.entries(updates)) {
    const clean = cleanCarSheetName(name);
    if (clean) out[key] = { name: clean, at: nowIso };
    else delete out[key];
  }
  return out;
}
