/** Deterministic comparison for session-list driver filtering (no fuzzy matching). Safe for client bundles. */
export function normalizeLiveRcDriverNameForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a LiveRC-listed driver name refers to the driver the user configured in settings.
 *
 * Clubs append noise to a driver's real name inconsistently — "Tim Boundy M" ("M" = member tag),
 * trailing numbers, initials — and the same driver can be listed differently week to week, so a
 * stored alias/id would go stale. Instead we match loosely every time: exact wins, otherwise the
 * listed name matches if **every word (≥2 chars) of the configured name appears in it**.
 *
 * The ≥2-word requirement is the safety rail — a bare surname can't sweep the field — and combined
 * with the caller's ambiguity handling (argmax over driver ids, competitor de-selection) this stays
 * safe against the rare genuinely-different driver whose name contains yours.
 *
 * Mirrors the practice-list matcher that already shipped; unifies it with the race/detection paths,
 * which previously used strict equality. Inputs may be raw or already-normalized (normalize is idempotent).
 */
export function liveRcNameMatchesConfigured(listedName: string, configuredName: string): boolean {
  const listed = normalizeLiveRcDriverNameForMatch(listedName);
  const configured = normalizeLiveRcDriverNameForMatch(configuredName);
  if (!listed || !configured) return false;
  if (listed === configured) return true;
  const tokens = configured.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 2) return false;
  return tokens.every((t) => listed.includes(t));
}
