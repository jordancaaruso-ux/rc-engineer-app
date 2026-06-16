import {
  parseLapHistoryDateWindow,
  type LapHistoryDateWindow,
} from "@/lib/engineerPhase5/parseLapHistoryWindow";

export type LapHistoryPriorContext = {
  trackQuery: string;
  tireLabelContains: string | null;
  dateWindow: LapHistoryDateWindow | null;
};

export type LapHistoryQueryIntent = {
  trackQuery: string;
  /** Case-insensitive substring match on TireSet.label when set. */
  tireLabelContains: string | null;
  dateWindow: LapHistoryDateWindow | null;
  wantsBestLap: boolean;
  wantsAvgTop5: boolean;
  /** 1 = best, 2 = next best, etc. */
  lapRank: number;
  /** When set, find laps near this time (seconds) instead of rank. */
  lapTimeProbe: number | null;
};

const SETUP_SIGNAL_RE =
  /\b(setup|shim|camber|toe|spring|diff|wing|balance|handling|understeer|oversteer|droop|caster|arb|damper|roll\s*cent|geometry|tune|tuning)\b/i;

const LAP_HISTORY_RE =
  /\b(best|fastest|quickest|slowest)\b[\s\S]{0,40}\b(lap|time|pace|laptime)s?\b|\b(lap\s*time|laptime)s?\b[\s\S]{0,40}\b(best|fastest|quickest|at|on)\b|\bwhat(?:'s| is)\s+my\s+(best|fastest|quickest)\b|\bhow\s+fast\b[\s\S]{0,30}\b(at|on)\b/i;

const LAP_HISTORY_FOLLOWUP_RE =
  /\b(?:what(?:'s| is)\s+(?:my\s+)?)?(?:next|second|2nd|third|3rd|\d+(?:st|nd|rd|th)?)\s+best\b|\bnext\s+(?:fastest|quickest)\s+lap\b/i;

const LAP_TIME_CORRECTION_RE =
  /\b(?:no\b|not\b|wrong|actually|i\s+(?:have|'ve|ve)\s+(?:done|run|had|got))\b/i;

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

/** 1-based rank: 1 = best, 2 = next best, … */
export function extractLapRank(message: string): number | null {
  const msg = message.trim();
  if (/\bnext\s+(?:best|fastest|quickest)\b/i.test(msg)) return 2;
  if (/\bsecond\s+best\b|\b2nd\s+best\b/i.test(msg)) return 2;
  if (/\bthird\s+best\b|\b3rd\s+best\b/i.test(msg)) return 3;
  const m = msg.match(/\b(\d+)(?:st|nd|rd|th)?\s+best\b/i);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (n >= 1 && n <= 20) return n;
  }
  return null;
}

/** Parse a mentioned lap time like 15.5 from a correction message. */
export function extractLapTimeProbe(message: string): number | null {
  const m = message.match(/\b(\d{1,2}\.\d{1,3})\b/);
  if (!m) return null;
  const v = parseFloat(m[1]!);
  if (!Number.isFinite(v) || v < 5 || v > 120) return null;
  return v;
}

/** Carry track / tire / window from earlier lap-history turns in the thread. */
export function extractLapHistoryPriorFromMessages(
  messages: Array<{ role: string; content: string }>
): LapHistoryPriorContext | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant") {
      const atTrack = m.content.match(/\bAt \*\*([^*]+)\*\*/);
      if (atTrack) {
        const name = atTrack[1]!.trim();
        const tireM = m.content.match(/\btire \*\*([^*]+)\*\*/);
        return {
          trackQuery: name,
          tireLabelContains: tireM?.[1]?.trim() ?? null,
          dateWindow: null,
        };
      }
    }
    if (m.role === "user") {
      const intent = parseLapHistoryQueryIntent(m.content);
      if (intent?.trackQuery) {
        return {
          trackQuery: intent.trackQuery,
          tireLabelContains: intent.tireLabelContains,
          dateWindow: intent.dateWindow,
        };
      }
    }
  }
  return null;
}

function parseStandaloneLapHistory(message: string): LapHistoryQueryIntent | null {
  const msg = message.trim();
  if (msg.length < 8 || !LAP_HISTORY_RE.test(msg)) return null;
  if (SETUP_SIGNAL_RE.test(msg)) return null;

  const tireLabelContains = extractTireLabelContains(msg);
  const forTrack = stripTireQualifierClause(msg);
  const trackQuery = extractTrackQuery(forTrack);
  if (!trackQuery) return null;

  const lapRank = extractLapRank(msg) ?? 1;
  const wantsBestLap = /\b(best|fastest|quickest|how\s+fast)\b/i.test(msg);
  const wantsAvgTop5 =
    /\b(avg|average)\b[\s\S]{0,20}\b(top\s*5|5)\b/i.test(msg) || /\btop\s*5\b/i.test(msg);

  if (!wantsBestLap && !wantsAvgTop5) {
    return {
      trackQuery,
      tireLabelContains,
      dateWindow: null,
      wantsBestLap: true,
      wantsAvgTop5: lapRank === 1,
      lapRank,
      lapTimeProbe: null,
    };
  }

  return {
    trackQuery,
    tireLabelContains,
    dateWindow: null,
    wantsBestLap,
    wantsAvgTop5: wantsAvgTop5 && lapRank === 1,
    lapRank,
    lapTimeProbe: null,
  };
}

export function parseLapHistoryQueryIntent(
  message: string,
  prior?: LapHistoryPriorContext | null
): LapHistoryQueryIntent | null {
  const standalone = parseStandaloneLapHistory(message);
  if (standalone) return standalone;

  const msg = message.trim();
  if (!prior || msg.length < 4) return null;
  if (SETUP_SIGNAL_RE.test(msg)) return null;

  const lapTimeProbe = LAP_TIME_CORRECTION_RE.test(msg) ? extractLapTimeProbe(msg) : null;
  if (lapTimeProbe != null) {
    return {
      trackQuery: prior.trackQuery,
      tireLabelContains: prior.tireLabelContains,
      dateWindow: prior.dateWindow,
      wantsBestLap: false,
      wantsAvgTop5: false,
      lapRank: 1,
      lapTimeProbe,
    };
  }

  if (!LAP_HISTORY_FOLLOWUP_RE.test(msg)) return null;

  const lapRank = extractLapRank(msg) ?? 2;
  return {
    trackQuery: prior.trackQuery,
    tireLabelContains: prior.tireLabelContains,
    dateWindow: prior.dateWindow,
    wantsBestLap: true,
    wantsAvgTop5: false,
    lapRank,
    lapTimeProbe: null,
  };
}

export { parseLapHistoryDateWindow };
