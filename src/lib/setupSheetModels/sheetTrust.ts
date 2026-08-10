/**
 * May a setup's values be read for MEANING, or only shown back to the driver?
 *
 * Pure module — no server imports — so the rule can be unit-tested without a database. Same reason
 * `modelAccess.ts` and `catalogAccessLogic.ts` are pure.
 *
 * ================================ THE RULE ================================
 *
 * Founder ruling, 2026-08-10, on sheets the app derived from a driver's own PDF:
 *
 *   > it should never be able to read it accurately, boxes are never 100% accurate. just let it be
 *   > used, only once a car is properly calibrated should anything beyond that happen
 *
 * So there is exactly one question and one answer, and the answer does not depend on how good the
 * sheet's box names happen to look. A PDF that names its boxes `fr-shock-oil` gets no more trust
 * than one that names them `text91`. Both are `record_only`. Only a curated chassis whose
 * calibration Jordan has green-lit is `calibrated`.
 *
 * That collapse is deliberate. Trusting the well-named sheets would mean trusting a manufacturer's
 * internal field names to mean what they appear to mean, across every brand, forever — which is
 * exactly the guess the 2026-08-06 pipeline deletion was about.
 *
 * ================================ WHAT EACH LEVEL ALLOWS ================================
 *
 * `record_only` — the driver may see it, fill it, edit it, save it, attach it to a run, export it
 * back to PDF, and compare it against their own other setups on the same sheet. Comparing needs no
 * understanding: "you changed box 47 from 4.5 to 5.0" is true whether or not anyone knows what box
 * 47 is.
 *
 * `calibrated` — everything above, plus the Engineer may read it and it may join community numbers.
 *
 * ================================ WHERE IT IS ENFORCED ================================
 *
 * Two of the three consumers already hold, and both hold by accident rather than by rule, which is
 * why this predicate exists:
 *
 *  - `rebuildCommunityTemplateAggregations` already skips cars whose model is unauthorized, before
 *    both the per-chassis bucket and the shared pool. Inherited free; pinned by a test.
 *  - Every Engineer surface filters setup keys through the `isTuningComparisonKey` allowlist, which
 *    no derived key can satisfy. That protection disappears the moment anything writes a
 *    `universalParameterId` onto a derived field, so it is not something to rely on.
 *
 * The shipped Engineer reads no setup data at all — its prompt says so outright. So this is mostly
 * a guard that must hold when the Engineer starts reading setups again.
 */

export type SheetTrust = "record_only" | "calibrated";

export type SheetTrustInput = {
  /** Curated catalog entry. A driver's derived sheet is never authorized. */
  isAuthorized: boolean;
  /** At least one calibration on this chassis that Jordan has green-lit. */
  hasGreenLitCalibration: boolean;
};

export function sheetTrustForModel(model: SheetTrustInput | null | undefined): SheetTrust {
  if (!model) return "record_only";
  return model.isAuthorized && model.hasGreenLitCalibration ? "calibrated" : "record_only";
}

/**
 * The one question every consumer asks before reading a setup's values for meaning.
 *
 * Phrased as a positive permission rather than `isDerived`, so a caller that forgets to handle a
 * new sheet kind fails closed.
 */
export function sheetMayFeedReasoning(trust: SheetTrust): boolean {
  return trust === "calibrated";
}

/** Convenience for the common shape: a model row straight out of Prisma plus its green-lit flag. */
export function modelMayFeedReasoning(model: SheetTrustInput | null | undefined): boolean {
  return sheetMayFeedReasoning(sheetTrustForModel(model));
}
