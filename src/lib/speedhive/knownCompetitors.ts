import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";

/**
 * Transponder numbers you know — a teammate's, a rival's, the fast kid in your class.
 *
 * MYLAPS publishes practice under the chip, not under an account: `practice-api.speedhive.com`
 * will hand over any chip's sessions and laps to an unauthenticated caller (verified against
 * the live API 2026-08-26). We have always called those endpoints with the viewer's own number
 * and never anyone else's, which is the only reason "compare my run to theirs" needed their
 * URL rather than just their number.
 *
 * So this is a phone book, and nothing more. Nothing here is fetched on a schedule: a saved
 * competitor is pulled WHEN ASKED (founder call 2026-08-27), because a background poller
 * against a timing service, for a driver who is not our customer, is a different product with
 * different manners.
 *
 * Stored as one JSON app-setting rather than a table: it is a short list, it belongs to one
 * account, and it needs no migration to exist.
 */

export type KnownCompetitor = {
  /** What you call them. Never fetched from timing — it's your label, on your list. */
  name: string;
  /** Digits only, normalised on the way in so two spellings of one chip can't both be saved. */
  transponder: string;
};

/** Keeps one person from filling the list, and keeps the setting row small. */
export const MAX_KNOWN_COMPETITORS = 40;

export function parseKnownCompetitorsSetting(raw: string | null | undefined): KnownCompetitor[] {
  const text = raw?.trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: KnownCompetitor[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const transponder = normalizeSpeedhiveTransponderNumber(
      typeof o.transponder === "number" || typeof o.transponder === "string" ? o.transponder : ""
    );
    if (!transponder) continue;
    // One row per chip. The chip is the identity; the name is decoration on top of it,
    // so a second row for the same number is an edit of the first, not a new competitor.
    if (seen.has(transponder)) continue;
    seen.add(transponder);
    const name = typeof o.name === "string" ? o.name.trim() : "";
    out.push({ name: name || `Chip ${transponder}`, transponder });
    if (out.length >= MAX_KNOWN_COMPETITORS) break;
  }
  return out;
}

export function serializeKnownCompetitorsSetting(list: KnownCompetitor[]): string {
  const seen = new Set<string>();
  const clean: KnownCompetitor[] = [];
  for (const c of list) {
    const transponder = normalizeSpeedhiveTransponderNumber(c.transponder ?? "");
    if (!transponder || seen.has(transponder)) continue;
    seen.add(transponder);
    clean.push({ name: (c.name ?? "").trim() || `Chip ${transponder}`, transponder });
    if (clean.length >= MAX_KNOWN_COMPETITORS) break;
  }
  return JSON.stringify(clean);
}
