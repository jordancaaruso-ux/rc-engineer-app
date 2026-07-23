/**
 * Shared guard for track-name extraction. The planning route and the lap-history route
 * both pull a track out of free text with loose "at/on <x>" regexes, and they drifted:
 * one got a non-track-lead guard, the other didn't — so the same bug shipped twice
 * ("going to tftr … based on how the previous day there went" captured "how the previous
 * day…" and dead-ended on an unmatchable track). Keep the guard here so both routes agree.
 */

/**
 * First tokens that begin ordinary clauses, never a track name: relative/prepositional
 * leads ("based **on how**…", "at **the** moment"), pronouns/determiners, time words, and
 * the common infinitive verbs that follow "going to" ("going to **prepare** for…").
 */
export const NON_TRACK_LEAD_RE =
  /^(how|what|why|when|where|which|who|the|a|an|this|that|these|those|it|its|my|your|our|their|his|her|previous|last|next|day|days|week|weekend|today|tomorrow|now|then|here|there|some|any|things|thing|power|throttle|entry|exit|corner|mid|grip|tyres?|tires?|setup|prepare|prep|test|try|change|run|do|get|see|check|work|focus|look|start|sort|dial|tune|figure|improve|fix|race|drive|practice)\b/i;

export function isPlausibleTrackName(raw: string): boolean {
  const s = raw.trim();
  return s.length >= 2 && !NON_TRACK_LEAD_RE.test(s);
}
