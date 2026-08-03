import { normalizeSpeedhiveDriverNameForMatch } from "@/lib/speedhive/speedhiveNameNormalize";

/**
 * Every name you appear under on a timing sheet.
 *
 * A transponder is registered *to a name*, and drivers own several chips — so
 * the names come in sets too: the club that types "Jordan Caruso", the one that
 * enters "J Caruso", the borrowed car still registered to its owner, the event
 * that prints your surname first. One stored name means every sheet that spells
 * you differently silently fails to match, and a chip only saves you when the
 * session actually publishes transponder numbers, which plenty don't.
 *
 * Split on NEWLINES ONLY, never commas. Timing sheets print "Caruso, Jordan"
 * often enough that comma-splitting would turn one name into two single-token
 * fragments — and `speedhiveDriverNameMatches` needs two tokens before it will
 * do a subset match, so those fragments would only ever match on exact string
 * equality. Comma-splitting looks like a convenience and is actually a silent
 * downgrade in matching. The chip editor adds one name per keystroke commit, so
 * there is nothing to separate anyway.
 */

/** Parse the stored setting: a JSON array, or one name per line. */
export function parseSpeedhiveDriverNamesSetting(raw: string | null | undefined): string[] {
  const text = raw?.trim();
  if (!text) return [];

  let parts: string[];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      parts = Array.isArray(parsed) ? parsed.map((v) => String(v)) : [text];
    } catch {
      parts = text.split(/\r?\n/);
    }
  } else {
    parts = text.split(/\r?\n/);
  }

  // Dedupe on the normalized form so "Jordan Caruso" and "jordan  caruso" don't
  // both take up a row, but keep the spelling the driver actually typed.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const name = part.trim();
    if (!name) continue;
    const norm = normalizeSpeedhiveDriverNameForMatch(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(name);
  }
  return out;
}

/** Round-trips through `parseSpeedhiveDriverNamesSetting`. */
export function formatSpeedhiveDriverNamesForSetting(names: string[]): string {
  return names.map((n) => n.trim()).filter(Boolean).join("\n");
}

/** Normalized forms for matching — empties dropped, deduped. */
export function normalizeSpeedhiveDriverNamesForMatch(names: string[]): string[] {
  const seen = new Set<string>();
  for (const name of names) {
    const norm = normalizeSpeedhiveDriverNameForMatch(name ?? "");
    if (norm) seen.add(norm);
  }
  return [...seen];
}
