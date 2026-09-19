/**
 * Deterministic comparison for session-list driver filtering (no fuzzy matching). Safe for client bundles.
 *
 * A configured value can hold several names, one per line (see `parseLiveRcDriverNamesSetting`), and
 * most callers normalize it BEFORE handing it to `liveRcNameMatchesConfigured` — so the line breaks
 * have to survive this, or two names would fuse into one four-word name that matches nobody. A
 * single-line input comes out exactly as it always did.
 */
export function normalizeLiveRcDriverNameForMatch(s: string): string {
  return s
    .split(/\r?\n/)
    .map((line) =>
      line
        .toLowerCase()
        .replace(/[.,;:]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

function listedMatchesOneName(listed: string, configured: string): boolean {
  if (listed === configured) return true;
  const tokens = configured.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 2) return false;
  return tokens.every((t) => listed.includes(t));
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
 * `configuredName` may carry several names, one per line (a nickname at one club, the full name at
 * another); the listing matches when it matches any of them. A one-word nickname is held to the same
 * rail as a bare surname: it matches only a listing that is exactly that word.
 *
 * Mirrors the practice-list matcher that already shipped; unifies it with the race/detection paths,
 * which previously used strict equality. Inputs may be raw or already-normalized (normalize is idempotent).
 */
export function liveRcNameMatchesConfigured(listedName: string, configuredName: string): boolean {
  const listed = normalizeLiveRcDriverNameForMatch(listedName).replace(/\n/g, " ");
  if (!listed) return false;
  const names = normalizeLiveRcDriverNameForMatch(configuredName).split("\n").filter(Boolean);
  return names.some((name) => listedMatchesOneName(listed, name));
}

/**
 * The stored "Name on LiveRC" setting as a list: one name per line, same shape as the MYLAPS names
 * (`parseSpeedhiveDriverNamesSetting`) and for the same reason — never commas, a sheet that prints
 * "Caruso, Jordan" is one name. A value saved before there could be several parses to a list of one.
 */
export function parseLiveRcDriverNamesSetting(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? "").split(/\r?\n/)) {
    const name = part.trim();
    if (!name) continue;
    const norm = normalizeLiveRcDriverNameForMatch(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(name);
  }
  return out;
}

/** Round-trips through `parseLiveRcDriverNamesSetting`. */
export function formatLiveRcDriverNamesForSetting(names: string[]): string {
  return names.map((n) => n.trim()).filter(Boolean).join("\n");
}

/** The stored setting on one line, for a sentence shown to the driver. */
export function formatLiveRcDriverNamesForDisplay(raw: string | null | undefined): string {
  return parseLiveRcDriverNamesSetting(raw).join(" / ");
}

/**
 * The transponder number LiveRC prints against a practice row, when it prints one.
 *
 * The row text runs name, class and transponder together — "Cooper DavisModified (4344915)" — so
 * the number is the trailing bracket.
 */
export function liveRcPracticeRowTransponder(rowText: string | null | undefined): number | null {
  const match = /\((\d{4,10})\)\s*$/.exec(rowText?.trim() ?? "");
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Is this practice-list row the driver's own session?
 *
 * The chip decides when the row prints one the driver has saved: it is exact, and it still finds
 * them on the day a club typed their name some new way. It only ever ADDS a match — a row whose
 * chip is not on the driver's list still falls through to the name, because a borrowed or
 * brand-new chip under the driver's own name is still their run.
 */
export function liveRcPracticeRowIsMine(
  rowText: string,
  configuredName: string,
  transponders: readonly number[]
): boolean {
  const chip = liveRcPracticeRowTransponder(rowText);
  if (chip != null && transponders.includes(chip)) return true;
  return configuredName ? liveRcNameMatchesConfigured(rowText, configuredName) : false;
}
