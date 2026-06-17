export type TireComparisonQueryIntent = {
  tireA: string;
  tireB: string;
  trackQuery: string | null;
};

const TIRE_SIGNAL_RE = /\b(tire|tyre|rubber|compound)\b/i;

const TRACK_TAIL_RE =
  /\s+(?:at|on)\s+([a-z0-9][a-z0-9\s\-'.]{1,48}?)(?=\s+in\b|[?.!,]|$)/i;

function cleanTireLabel(raw: string): string {
  return raw
    .replace(/\b(tires?|tyres?|rubber|compound)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTrack(msg: string): { rest: string; trackQuery: string | null } {
  const m = msg.match(TRACK_TAIL_RE);
  if (!m) return { rest: msg, trackQuery: null };
  return {
    rest: msg.replace(TRACK_TAIL_RE, "").trim(),
    trackQuery: m[1]!.trim(),
  };
}

function splitTwoTires(rest: string): { tireA: string; tireB: string } | null {
  const patterns = [
    /^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i,
    /^difference\s+between\s+(.+?)\s+and\s+(.+)$/i,
    /^(.+?)\s+and\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = rest.match(re);
    if (!m) continue;
    const tireA = cleanTireLabel(m[1]!);
    const tireB = cleanTireLabel(m[2]!);
    if (tireA.length >= 2 && tireB.length >= 2) return { tireA, tireB };
  }
  return null;
}

const SETUP_COMPARE_RE =
  /\b(setup|shim|spring|practice run|q run|qualifying|session)\b/i;

export function parseTireComparisonQuery(message: string): TireComparisonQueryIntent | null {
  const msg = message.trim();
  if (!/\b(compare|versus|vs\.?|difference between)\b/i.test(msg)) return null;
  if (SETUP_COMPARE_RE.test(msg) && !TIRE_SIGNAL_RE.test(msg)) return null;
  if (!TIRE_SIGNAL_RE.test(msg) && !/\bvs\.?\b/i.test(msg)) return null;

  let body = msg.replace(/^\s*compare\s+/i, "").trim();
  const { rest, trackQuery } = extractTrack(body);
  body = rest.replace(/\b(tires?|tyres?|rubber|compounds?)\b/gi, "").trim();

  const pair = splitTwoTires(body);
  if (!pair) return null;

  return { tireA: pair.tireA, tireB: pair.tireB, trackQuery };
}
