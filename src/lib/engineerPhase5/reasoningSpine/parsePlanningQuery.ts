import { isPlausibleTrackName } from "@/lib/engineerPhase5/trackNameGuard";

export type PlanningQueryIntent = {
  trackQuery: string | null;
  wantsSetupConsiderations: boolean;
};

const PLANNING_SIGNAL_RE =
  /\b(next meeting|next race|this weekend|tomorrow|going to|prepare for|what should i consider|first thing|before the race)\b/i;

/**
 * Strongest signal: the track rides directly on a travel verb —
 * "going/heading to tftr", "racing/testing at Boronia". Non-greedy capture stops at the
 * next clause boundary so "going to tftr in a few days" yields "tftr". Candidates are
 * still passed through the shared non-track-lead guard (e.g. "going to prepare for…").
 */
const TRACK_TRAVEL_RE =
  /\b(?:going|go|heading|head|driving|drive|travel(?:ling|ing)?|off|racing|race|testing|test)\s+(?:to|at)\s+([a-z0-9][a-z0-9\s\-'.]{1,48}?)(?=\s+in\b|\s+this\b|\s+next\b|\s+on\b|\s+over\b|\s+for\b|\s+again\b|\s+tomorrow\b|[?.!,]|$)/i;

/** Looser fallback: "at/on <x>" anywhere. Weak — leans on the shared non-track-lead guard. */
const TRACK_PREP_RE =
  /\b(?:at|on)\s+([a-z0-9][a-z0-9\s\-'.]{1,48}?)(?=\s+in\b|\s+this\b|[?.!,]|$)/i;

function extractTrackQuery(message: string): string | null {
  for (const re of [TRACK_TRAVEL_RE, TRACK_PREP_RE]) {
    const raw = message.match(re)?.[1]?.trim();
    if (raw && isPlausibleTrackName(raw)) return raw;
  }
  return null;
}

export function parsePlanningQuery(message: string): PlanningQueryIntent | null {
  const msg = message.trim();
  if (!PLANNING_SIGNAL_RE.test(msg)) return null;

  const trackQuery = extractTrackQuery(msg);
  const wantsSetupConsiderations =
    /\b(setup|change|consider|tune|shim|spring|tire)\b/i.test(msg);

  return { trackQuery, wantsSetupConsiderations };
}
