import "server-only";

/**
 * Cheap pattern checks for systematic mistakes on setup-compare answers.
 * Not exhaustive; pairs with prompt + deterministic context fields.
 */
export function validateEngineerSetupCompareReply(text: string): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const t = text;

  if (/raising\s+(the\s+)?upper\s+inner/i.test(t) && /higher\s+roll\s*cent/i.test(t)) {
    reasons.push("Raising upper inner incorrectly paired with higher roll centre.");
  }

  if (
    /increased\s+([^\n]{0,80})roll\s*cent/i.test(t) &&
    /upper\s+inner/i.test(t) &&
    /\b(rais|raised|raising)\b/i.test(t)
  ) {
    reasons.push("Increased roll centre attributed to upper inner raise (platform: raise upper inner lowers RC).");
  }

  if (
    /\bflatter\b/i.test(t) &&
    /\b(more\s+responsive|enhances?\s+responsiveness|enhance\s+the\s+car'?s\s+responsiveness)\b/i.test(t)
  ) {
    reasons.push('Flatter / lower RC paired with "responsive" boost — use smoother, in the track, less initial bite.');
  }

  if (/\blowering\s+(the\s+)?upper\s+outer\b/i.test(t) && /\bhigher\s+roll\s*cent/i.test(t)) {
    reasons.push("Lowering upper outer incorrectly paired with higher roll centre.");
  }

  return { ok: reasons.length === 0, reasons };
}

export function buildSetupCompareRetryUserMessage(reasons: string[]): string {
  return (
    "Your previous answer failed automated consistency checks. Regenerate a full replacement. " +
    "Issues: " +
    reasons.join(" ") +
    " Follow the FIXED ANSWER SHAPE (sections A–C). Never claim raising upper inner increases roll centre. " +
    "Never describe flatter / lower RC as increasing responsiveness—use smoother, more in the track, less initial bite, or mid-corner / overall grip language from the KB. " +
    "Quote frontAxleNetNote, rearAxleNetNote, bulkheadFrontVsRearAvgNote, frontUpperInnerBulkheadSplitNote, rearUpperInnerBulkheadSplitNote, frontLowerArmAntiGeometryNote and rearLowerArmAntiGeometryNote when non-null, and every rcEffectLine verbatim in section A."
  );
}
