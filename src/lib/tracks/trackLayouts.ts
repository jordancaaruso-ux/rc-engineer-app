/**
 * Named track layouts ("Club layout", "Reverse"): the rules both layout routes share.
 *
 * Any driver may add a layout to any track, and everyone racing there sees it (founder ruling
 * 2026-09-26, the same "contribution, not identity" line as the grip and layout tags). It is added
 * from Log run without leaving the run (`POST /api/tracks/[trackId]/layouts`). Renaming, reordering
 * and removing stay with whoever added the track, and admins, on the track page (`PUT`).
 */

/** Longest layout name either route accepts. */
export const LAYOUT_NAME_MAX = 120;

/** A layout name as stored: trimmed, with runs of spaces made one. */
export function normalizeLayoutName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * The layout this track already has under that name, if any. Two drivers typing "Club layout" and
 * "club  Layout" mean the same layout, so the second one is handed the first instead of a copy.
 */
export function findLayoutByName<T extends { name: string }>(layouts: readonly T[], name: string): T | null {
  const key = normalizeLayoutName(name).toLowerCase();
  if (!key) return null;
  return layouts.find((l) => normalizeLayoutName(l.name).toLowerCase() === key) ?? null;
}

/**
 * Which existing layouts a save from the track page removes: the ones that page loaded and then took
 * out. A layout another driver added after the page loaded never reached it, so it is not that
 * save's to drop. Without `knownIds` (a page from before this rule) every missing layout goes.
 */
export function layoutIdsToDelete(
  existingIds: readonly string[],
  keptIds: ReadonlySet<string>,
  knownIds: ReadonlySet<string> | null
): string[] {
  return existingIds.filter((id) => !keptIds.has(id) && (knownIds === null || knownIds.has(id)));
}
