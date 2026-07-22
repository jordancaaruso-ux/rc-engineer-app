export type PlanningQueryIntent = {
  trackQuery: string | null;
  wantsSetupConsiderations: boolean;
};

const PLANNING_SIGNAL_RE =
  /\b(next meeting|next race|this weekend|tomorrow|going to|prepare for|what should i consider|first thing|before the race)\b/i;

/** Candidate track name: starts alphanumeric, stops at a clause boundary. */
const TRACK_NAME = "([a-z0-9][a-z0-9\\s\\-'.]{1,48}?)";
const TRACK_STOP = "(?=\\s+(?:in|this|next|for|on|and|so|but|before|after|with)\\b|[?.!,]|$)";

/** "going to tftr", "heading over to Melbourne" — travel phrasing is the strongest signal. */
const TRACK_TRAVEL_RE = new RegExp(
  `\\b(?:going|heading|travell?ing|driving|racing|flying)\\s+(?:back\\s+|over\\s+|up\\s+|down\\s+)?to\\s+${TRACK_NAME}${TRACK_STOP}`,
  "i"
);

/** Bare "at <track>" / "on <track>" — much looser, so it's guarded by NON_TRACK_LEAD_RE. */
const TRACK_PREP_RE = new RegExp(`\\b(?:at|on)\\s+${TRACK_NAME}${TRACK_STOP}`, "i");

/**
 * "at"/"on" introduce ordinary prepositional phrases far more often than track names
 * ("based **on how** the previous day went", "**on power**", "**at the** moment"). A candidate
 * whose first word is one of these is never a track — without this guard the loose pattern
 * captured whole clauses and the route dead-ended on an unmatchable "track".
 */
const NON_TRACK_LEAD_RE =
  /^(?:how|what|why|when|where|which|who|whether|the|a|an|any|some|all|both|my|our|your|their|his|her|its|it|this|that|these|those|and|or|but|if|so|then|than|power|throttle|corner|corners|entry|exit|apex|turn|turns|lap|laps|bumps|kerbs|curbs|grip|tyres?|tires?|average|top|more|less|high|low|front|rear|left|right|inside|outside|paper|purpose|track|day|days|week|weekend|time|times)\b/i;

/**
 * "going **to prepare** for…" is an infinitive, not a destination. Deliberately omits
 * race/practice/drive — those lead real track names, and a bad guess now falls through to the
 * full Engineer rather than dead-ending.
 */
const INFINITIVE_LEAD_RE =
  /^(?:prepare|test|try|do|make|change|check|see|look|go|get|put|take|give|use|find|fix|add|remove|keep|start|stop|learn|ask|bring|buy|swap|set|sort|work|run|tune|be|have)\b/i;

function extractTrackQuery(msg: string): string | null {
  const travel = msg.match(TRACK_TRAVEL_RE)?.[1]?.trim();
  if (travel && isPlausibleTrackName(travel) && !INFINITIVE_LEAD_RE.test(travel)) return travel;

  const prep = msg.match(TRACK_PREP_RE)?.[1]?.trim();
  if (prep && isPlausibleTrackName(prep)) return prep;

  return null;
}

function isPlausibleTrackName(candidate: string): boolean {
  if (candidate.length < 2) return false;
  if (NON_TRACK_LEAD_RE.test(candidate)) return false;
  // Real track names are short ("tftr", "Melbourne Off Road Model Car Club"), clauses aren't.
  if (candidate.split(/\s+/).length > 6) return false;
  return true;
}

export function parsePlanningQuery(message: string): PlanningQueryIntent | null {
  const msg = message.trim();
  if (!PLANNING_SIGNAL_RE.test(msg)) return null;

  const trackQuery = extractTrackQuery(msg);
  const wantsSetupConsiderations =
    /\b(setup|change|consider|tune|test|shim|spring|tire)\b/i.test(msg);

  return { trackQuery, wantsSetupConsiderations };
}
