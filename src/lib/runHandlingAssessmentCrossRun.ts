import {
  HANDLING_TRAIT_AXIS_UI,
  formatPhaseBalanceWord,
  formatPrimaryFocusLine,
  parseHandlingAssessmentJson,
  type CornerPhase,
  type HandlingTraitAxisKey,
  type PhaseBalance,
  type RunHandlingAssessmentParsed,
} from "@/lib/runHandlingAssessment";

const PHASES: CornerPhase[] = ["entry", "mid", "exit"];
const TRAIT_AXES: HandlingTraitAxisKey[] = ["feelSteering", "feelGeneral", "driveEase", "tractionRoll"];

const MAX_BLOCK_CHARS = 1400;

const FEEL_VS_LAST_FOOTNOTE =
  "Note: “Feel vs last run” is each run’s rating vs its own immediately previous outing on this car — not a direct compare-vs-primary score; do not subtract those two numbers.";

function isPb(n: unknown): n is PhaseBalance {
  return typeof n === "number" && Number.isInteger(n) && n >= -3 && n <= 3;
}

function feelVsLastFootnoteNeeded(
  compare: RunHandlingAssessmentParsed | null,
  primary: RunHandlingAssessmentParsed | null
): boolean {
  return Boolean(
    (compare != null && compare.feelVsLastRun != null) || (primary != null && primary.feelVsLastRun != null)
  );
}

function scaleTrendPhrase(deltaPrimaryMinusCompare: number): string {
  if (deltaPrimaryMinusCompare > 0) {
    return `shifted toward oversteer vs compare by ${deltaPrimaryMinusCompare} step(s) on the −3 push … +3 oversteer scale`;
  }
  if (deltaPrimaryMinusCompare < 0) {
    return `shifted toward push vs compare by ${-deltaPrimaryMinusCompare} step(s) on the −3 push … +3 oversteer scale`;
  }
  return "no net shift on this axis vs compare";
}

function cornerBalanceLine(
  phase: CornerPhase,
  compare: RunHandlingAssessmentParsed,
  primary: RunHandlingAssessmentParsed
): string | null {
  const cv = compare.balanceByPhase?.[phase];
  const pv = primary.balanceByPhase?.[phase];
  if (!isPb(cv) && !isPb(pv)) return null;
  if (isPb(cv) && isPb(pv) && cv === pv) return null;
  const cTxt = isPb(cv) ? formatPhaseBalanceWord(cv) : "no corner-balance data";
  const pTxt = isPb(pv) ? formatPhaseBalanceWord(pv) : "no corner-balance data";
  let tail = "";
  if (isPb(cv) && isPb(pv)) {
    const d = pv - cv;
    if (d !== 0) tail = ` — ${scaleTrendPhrase(d)}.`;
    else tail = " — same score vs compare.";
  }
  return `Corner ${phase} (compare → primary): ${cTxt} → ${pTxt}.${tail}`;
}

function traitLine(
  axis: HandlingTraitAxisKey,
  compare: RunHandlingAssessmentParsed,
  primary: RunHandlingAssessmentParsed
): string | null {
  const cv = compare[axis];
  const pv = primary[axis];
  if (!isPb(cv) && !isPb(pv)) return null;
  if (isPb(cv) && isPb(pv) && cv === pv) return null;
  const meta = HANDLING_TRAIT_AXIS_UI[axis];
  const cStr = isPb(cv) ? `${cv > 0 ? "+" : ""}${cv}` : "—";
  const pStr = isPb(pv) ? `${pv > 0 ? "+" : ""}${pv}` : "—";
  let tail = "";
  if (isPb(cv) && isPb(pv)) {
    const d = pv - cv;
    if (d !== 0) tail = ` (${scaleTrendPhrase(d)})`;
    else tail = " (unchanged vs compare)";
  }
  return `${meta.title} (−3 ${meta.neg} … +3 ${meta.pos}), compare → primary: ${cStr} → ${pStr}.${tail}`;
}

function primaryFocusLines(
  compare: RunHandlingAssessmentParsed,
  primary: RunHandlingAssessmentParsed
): string[] {
  const cf = compare.primaryFocus;
  const pf = primary.primaryFocus;
  if (!cf && !pf) return [];
  if (
    cf &&
    pf &&
    cf.kind === "balance" &&
    pf.kind === "balance" &&
    cf.phase === pf.phase &&
    isPb(cf.value) &&
    isPb(pf.value)
  ) {
    if (cf.value === pf.value) return [];
    const d = pf.value - cf.value;
    return [
      `Primary focus corner balance on ${cf.phase} (compare → primary): ${formatPhaseBalanceWord(cf.value)} → ${formatPhaseBalanceWord(pf.value)} — ${scaleTrendPhrase(d)}.`,
    ];
  }
  const out: string[] = [];
  if (cf) {
    const line = formatPrimaryFocusLine(cf);
    if (line) out.push(`Compare run — ${line}`);
  }
  if (pf) {
    const line = formatPrimaryFocusLine(pf);
    if (line) out.push(`Primary run — ${line}`);
  }
  return out;
}

/**
 * Deterministic, comparable handling deltas between two **calendar** runs (compare baseline → primary).
 * Does **not** treat `feelVsLastRun` as a direct A-vs-B delta; adds a footnote when either run has it.
 */
export function buildHandlingAssessmentCrossRunBlock(compareJson: unknown, primaryJson: unknown): string | null {
  const compare = parseHandlingAssessmentJson(compareJson);
  const primary = parseHandlingAssessmentJson(primaryJson);
  if (!primary && !compare) return null;
  if (!primary) return null;

  const header = "— Handling compare → primary (deterministic) —";
  const feelFoot = feelVsLastFootnoteNeeded(compare, primary);
  const deltas: string[] = [];

  if (compare) {
    for (const phase of PHASES) {
      const ln = cornerBalanceLine(phase, compare, primary);
      if (ln) deltas.push(ln);
    }
    for (const axis of TRAIT_AXES) {
      const ln = traitLine(axis, compare, primary);
      if (ln) deltas.push(ln);
    }
    deltas.push(...primaryFocusLines(compare, primary));
  } else {
    deltas.push(
      "Compare run has no parseable structured handling log — use handlingAssessmentJsonByRun.compare for raw JSON when present."
    );
  }

  if (deltas.length === 0 && !feelFoot) return null;

  const parts = [header, ...deltas];
  if (feelFoot) parts.push(FEEL_VS_LAST_FOOTNOTE);
  const out = parts.join("\n");
  return out.length > MAX_BLOCK_CHARS ? `${out.slice(0, MAX_BLOCK_CHARS - 1)}…` : out;
}
