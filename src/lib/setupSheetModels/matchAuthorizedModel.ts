import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";

/** Minimal shape needed to match free-typed chassis text to a global model. */
export type ChassisMatchModel = {
  id: string;
  name: string;
  isAuthorized: boolean;
};

function chassisTokens(text: string): string[] {
  const norm = normalizeSetupSheetModelName(text);
  return norm ? norm.split(" ").filter(Boolean) : [];
}

function allIn(tokens: string[], set: Set<string>): boolean {
  return tokens.length > 0 && tokens.every((t) => set.has(t));
}

/**
 * Resolve free-typed chassis/name text (e.g. "MTC3", "Mugen MTC3", "mugen mtc3 build 2") to the
 * single authorized global model it refers to, or null when there is no confident, unambiguous
 * match. This is the server-side safety net that stops a car from persisting with no setup sheet
 * model when the client omits one but the text clearly names a known chassis.
 *
 * Only **authorized** catalog rows are considered — they carry the curated global schema, so a
 * match always lands the car on the complete field set, never a sparse user-created duplicate.
 * Matching is deliberately conservative:
 *   1. exact normalized-name equality ("mugen mtc3" === "mugen mtc3"), else
 *   2. unique token-subset either direction (typed tokens ⊆ model tokens, or vice-versa).
 * If more than one distinct authorized model matches (e.g. "mugen" → MTC3 and MTC2, or "xray" →
 * T4 and X4) we return null and leave the link empty rather than guess wrong.
 */
export function pickAuthorizedModelIdForChassisText(
  text: string | null | undefined,
  models: ChassisMatchModel[]
): string | null {
  const queryTokens = chassisTokens(text ?? "");
  if (queryTokens.length === 0) return null;
  const querySet = new Set(queryTokens);
  const authorized = models.filter((m) => m.isAuthorized);

  // 1) exact normalized-name equality
  const normQuery = queryTokens.join(" ");
  const exact = authorized.filter((m) => normalizeSetupSheetModelName(m.name) === normQuery);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;

  // 2) unique token-subset either direction
  const matched = authorized.filter((m) => {
    const modelTokens = chassisTokens(m.name);
    const modelSet = new Set(modelTokens);
    return allIn(queryTokens, modelSet) || allIn(modelTokens, querySet);
  });
  const distinctIds = new Set(matched.map((m) => m.id));
  return distinctIds.size === 1 ? matched[0].id : null;
}
