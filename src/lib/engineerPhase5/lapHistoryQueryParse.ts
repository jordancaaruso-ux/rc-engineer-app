import {
  parseLapHistoryDateWindow,
  type LapHistoryDateWindow,
} from "@/lib/engineerPhase5/parseLapHistoryWindow";

export type LapHistoryQueryIntent = {
  trackQuery: string;
  /** Case-insensitive substring match on TireSet.label when set. */
  tireLabelContains: string | null;
  dateWindow: LapHistoryDateWindow | null;
  wantsBestLap: boolean;
  wantsAvgTop5: boolean;
};

const SETUP_SIGNAL_RE =
  /\b(setup|shim|camber|toe|spring|diff|wing|balance|handling|understeer|oversteer|droop|caster|arb|damper|roll\s*cent|geometry|tune|tuning)\b/i;

const LAP_HISTORY_RE =
  /\b(best|fastest|quickest|slowest)\b[\s\S]{0,40}\b(lap|time|pace|laptime)s?\b|\b(lap\s*time|laptime)s?\b[\s\S]{0,40}\b(best|fastest|quickest|at|on)\b|\bwhat(?:'s| is)\s+my\s+(best|fastest|quickest)\b|\bhow\s+fast\b[\s\S]{0,30}\b(at|on)\b/i;

/** "on vault tires", "with vaulk rubber", "using my Vault compound". */
const TIRE_QUALIFIER_RE =
  /\b(?:on|with|using)\s+(?:the\s+)?(?:my\s+)?([a-z0-9][a-z0-9\s\-'.]{0,40}?)\s+(?:tires?|tyres?|rubber|compound)\b/i;

export function extractTireLabelContains(message: string): string | null {
  const m = message.match(TIRE_QUALIFIER_RE);
  const raw = m?.[1]?.trim();
  if (!raw || raw.length < 2) return null;
  return raw.replace(/^(?:the|my)\s+/i, "").trim() || null;
}

/** Remove tire-compound clause so track extraction does not swallow it. */
export function stripTireQualifierClause(message: string): string {
  return message.replace(TIRE_QUALIFIER_RE, " ").replace(/\s+/g, " ").trim();
}

function extractTrackQuery(message: string): string | null {
  const patterns = [
    /\bat\s+([a-z0-9][a-z0-9\s\-'.]{1,48}?)(?=\s+in\b|\s+over\b|\s+during\b|\s+for\b|\s+last\b|\s+this\b|\s+(?:with|using)\b|[?.!,]|$)/i,
    /\bon\s+([a-z0-9][a-z0-9\s\-'.]{1,48}?)(?=\s+in\b|\s+over\b|\s+during\b|\s+for\b|\s+last\b|\s+this\b|\s+(?:with|using)\b|[?.!,]|$)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    const raw = m?.[1]?.trim();
    if (raw && raw.length >= 2) {
      return raw.replace(/\s+(in|over|during|for|within)\s+the\b.*$/i, "").trim();
    }
  }
  return null;
}

export function parseLapHistoryQueryIntent(message: string): LapHistoryQueryIntent | null {
  const msg = message.trim();
  if (msg.length < 8 || !LAP_HISTORY_RE.test(msg)) return null;
  if (SETUP_SIGNAL_RE.test(msg)) return null;

  const tireLabelContains = extractTireLabelContains(msg);
  const forTrack = stripTireQualifierClause(msg);
  const trackQuery = extractTrackQuery(forTrack);
  if (!trackQuery) return null;

  const wantsBestLap = /\b(best|fastest|quickest|how\s+fast)\b/i.test(msg);
  const wantsAvgTop5 =
    /\b(avg|average)\b[\s\S]{0,20}\b(top\s*5|5)\b/i.test(msg) || /\btop\s*5\b/i.test(msg);
  if (!wantsBestLap && !wantsAvgTop5) {
    return { trackQuery, tireLabelContains, dateWindow: null, wantsBestLap: true, wantsAvgTop5: true };
  }

  return {
    trackQuery,
    tireLabelContains,
    dateWindow: null,
    wantsBestLap,
    wantsAvgTop5,
  };
}

export { parseLapHistoryDateWindow };
