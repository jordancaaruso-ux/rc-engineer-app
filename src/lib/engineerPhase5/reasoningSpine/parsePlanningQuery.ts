import { isPlausibleTrackName } from "@/lib/engineerPhase5/trackNameGuard";

export type PlanningQueryIntent = {
  trackQuery: string | null;
  wantsSetupConsiderations: boolean;
};

const PLANNING_SIGNAL_RE =
  /\b(next meeting|next race|this weekend|tomorrow|going to|prepare for|what should i consider|first thing|before the race)\b/i;

/** Candidate track name: starts alphanumeric, stops at a clause boundary. */
const TRACK_NAME = "([a-z0-9][a-z0-9\\s\\-'.]{1,48}?)";
const TRACK_STOP =
  "(?=\\s+(?:in|this|next|on|over|for|again|tomorrow|and|so|but|before|after|with)\\b|[?.!,]|$)";

/**
 * Strongest signal: the track rides directly on a travel verb — "going/heading to tftr",
 * "heading over to Melbourne", "racing/testing at Boronia". Non-greedy capture stops at the
 * next clause boundary so "going to tftr in a few days" yields "tftr". Candidates are still
 * passed through the shared non-track-lead guard (e.g. "going to prepare for…"), which is where
 * the infinitive leads live — see trackNameGuard.ts.
 */
const TRACK_TRAVEL_RE = new RegExp(
  `\\b(?:going|go|heading|head|driving|drive|travel(?:ling|ing)?|flying|off|racing|race|testing|test)` +
    `\\s+(?:back\\s+|over\\s+|up\\s+|down\\s+)?(?:to|at)\\s+${TRACK_NAME}${TRACK_STOP}`,
  "i"
);

/** Looser fallback: "at/on <x>" anywhere. Weak — leans on the shared non-track-lead guard. */
const TRACK_PREP_RE = new RegExp(`\\b(?:at|on)\\s+${TRACK_NAME}${TRACK_STOP}`, "i");

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
    /\b(setup|change|consider|tune|test|shim|spring|tire)\b/i.test(msg);

  return { trackQuery, wantsSetupConsiderations };
}
