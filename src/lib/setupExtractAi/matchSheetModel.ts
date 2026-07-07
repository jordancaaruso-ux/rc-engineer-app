/**
 * Match a car identified from an uploaded sheet's header against the setup-sheet models
 * already in the app — the front door of "upload any car" (SETUP_UPLOAD_NORTH_STAR.md).
 * A confident match links the upload to that car; no match → offer instant new-car creation.
 *
 * Pure (no server-only / no DB) so it's unit-testable and callable from scripts. The caller
 * supplies the candidate models (the user's own + shared/global) already scoped for access.
 */

export type IdentifiedCar = {
  brand: string | null;
  /** Model / platform as printed, e.g. "X4'22", "MTC3", "A800". */
  model: string | null;
};

export type SheetModelCandidate = {
  id: string;
  /** Display name, e.g. "Xray X4'22", "Mugen MTC3". */
  name: string;
};

export type SheetModelMatch = {
  bestMatchId: string | null;
  score: number;
  isConfidentMatch: boolean;
  ranked: Array<{ id: string; name: string; score: number }>;
  /** Name to offer for instant new-car creation when nothing matches confidently. */
  suggestedNewCarName: string;
};

const CONFIDENT_MATCH_SCORE = 0.6;

/** Lowercase; apostrophes/punctuation → spaces (so "X4'22" → x4 + 22); 4-digit 20xx years → last two ("2022"→"22"). */
function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const m = /^20(\d{2})$/.exec(t);
      return m ? m[1] : t;
    });
}

/** A discriminative model token: mixes letters + digits (e.g. "x4", "mtc3", "a800", "tc7"). */
function isModelToken(t: string): boolean {
  return /[a-z]/.test(t) && /\d/.test(t);
}

function scoreTokens(queryTokens: string[], candidateTokens: string[]): number {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  const q = new Set(queryTokens);
  const c = new Set(candidateTokens);
  let inter = 0;
  for (const t of q) if (c.has(t)) inter++;
  const union = new Set([...q, ...c]).size;
  const jaccard = inter / union;

  // The distinctive model token (x4 / mtc3 / a800) carries most of the signal: a shared one
  // strongly boosts, a conflicting one (both sides have model tokens, none shared) caps low.
  const qModel = [...q].filter(isModelToken);
  const cModel = [...c].filter(isModelToken);
  const sharedModel = qModel.some((t) => c.has(t));
  if (sharedModel) return Math.min(1, 0.7 + 0.3 * jaccard);
  if (qModel.length > 0 && cModel.length > 0) return Math.min(jaccard, 0.35);
  return jaccard;
}

export function matchSheetModelForIdentifiedCar(
  identified: IdentifiedCar,
  candidates: SheetModelCandidate[]
): SheetModelMatch {
  const queryName = [identified.brand, identified.model].filter(Boolean).join(" ").trim();
  const queryTokens = normalizeTokens(queryName);

  const ranked = candidates
    .map((c) => ({ id: c.id, name: c.name, score: scoreTokens(queryTokens, normalizeTokens(c.name)) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const isConfidentMatch = !!best && best.score >= CONFIDENT_MATCH_SCORE;

  return {
    bestMatchId: isConfidentMatch ? best.id : null,
    score: best?.score ?? 0,
    isConfidentMatch,
    ranked,
    suggestedNewCarName: queryName || "New car",
  };
}
