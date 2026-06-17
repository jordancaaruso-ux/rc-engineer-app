export type PlanningQueryIntent = {
  trackQuery: string | null;
  wantsSetupConsiderations: boolean;
};

const PLANNING_SIGNAL_RE =
  /\b(next meeting|next race|this weekend|tomorrow|going to|prepare for|what should i consider|first thing|before the race)\b/i;

const TRACK_AT_RE =
  /\b(?:at|on)\s+([a-z0-9][a-z0-9\s\-'.]{1,48}?)(?=\s+in\b|\s+this\b|[?.!,]|$)/i;

export function parsePlanningQuery(message: string): PlanningQueryIntent | null {
  const msg = message.trim();
  if (!PLANNING_SIGNAL_RE.test(msg)) return null;

  const trackM = msg.match(TRACK_AT_RE);
  const trackQuery = trackM?.[1]?.trim() ?? null;
  const wantsSetupConsiderations =
    /\b(setup|change|consider|tune|shim|spring|tire)\b/i.test(msg);

  return { trackQuery, wantsSetupConsiderations };
}
