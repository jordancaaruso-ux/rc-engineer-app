import type { CornerPhase, PhaseBalance, RunHandlingAssessmentParsed } from "@/lib/runHandlingAssessment";
import type { QuickFixMagnitudeTier } from "@/lib/engineerPhase5/quickFix/quickFixTypes";

const PHASES: CornerPhase[] = ["entry", "mid", "exit"];

export function magnitudeTierFromCarRating(carRating: number | null | undefined): QuickFixMagnitudeTier {
  if (typeof carRating !== "number" || !Number.isFinite(carRating)) return "moderate";
  const r = Math.round(carRating);
  if (r <= 3) return "big";
  if (r <= 6) return "moderate";
  if (r <= 9) return "fine";
  return "minimal";
}

export function magnitudeTierLabel(tier: QuickFixMagnitudeTier): string {
  switch (tier) {
    case "big":
      return "big moves";
    case "moderate":
      return "moderate adjustments";
    case "fine":
      return "fine tweaks";
    case "minimal":
      return "minimal changes — celebrate what worked";
  }
}

export function magnitudeTierPromptLine(tier: QuickFixMagnitudeTier, carRating: number | null): string {
  const ratingBit =
    typeof carRating === "number" && Number.isFinite(carRating)
      ? `Car rated ${Math.round(carRating)}/10`
      : "Car rating missing";
  return `${ratingBit} → ${magnitudeTierLabel(tier)}.`;
}

function phaseDirectionLabel(value: PhaseBalance): "understeer" | "oversteer" | "neutral" {
  if (value < 0) return "understeer";
  if (value > 0) return "oversteer";
  return "neutral";
}

function phaseSeverity(abs: number): "mild" | "moderate" | "strong" {
  if (abs >= 3) return "strong";
  if (abs >= 2) return "moderate";
  return "mild";
}

/**
 * Infer the dominant on-track issue from per-phase balance chips (−3…+3).
 * Falls back to trait axes when phases are unset.
 */
export function inferPrimaryHandlingIssue(
  handling: RunHandlingAssessmentParsed | null
): string | null {
  if (!handling) return null;

  const phaseScores: Array<{ phase: CornerPhase; value: PhaseBalance; abs: number }> = [];
  for (const phase of PHASES) {
    const v = handling.balanceByPhase?.[phase];
    if (typeof v === "number" && v !== 0) {
      phaseScores.push({ phase, value: v as PhaseBalance, abs: Math.abs(v) });
    }
  }
  if (phaseScores.length > 0) {
    phaseScores.sort((a, b) => b.abs - a.abs);
    const top = phaseScores[0];
    const dir = phaseDirectionLabel(top.value);
    const sev = phaseSeverity(top.abs);
    if (dir === "neutral") return null;
    return `${sev} ${dir} in ${top.phase}`;
  }

  const traits: Array<{ label: string; value: PhaseBalance; abs: number }> = [];
  const traitDefs: Array<{ key: keyof typeof handling; label: string }> = [
    { key: "feelSteering", label: "steering feel" },
    { key: "feelGeneral", label: "general feel" },
    { key: "driveEase", label: "drive difficulty" },
    { key: "tractionRoll", label: "traction rolling" },
  ];
  for (const t of traitDefs) {
    const v = handling[t.key];
    if (typeof v === "number" && v !== 0) {
      traits.push({ label: t.label, value: v as PhaseBalance, abs: Math.abs(v) });
    }
  }
  if (traits.length === 0) return null;
  traits.sort((a, b) => b.abs - a.abs);
  const top = traits[0];
  const sev = phaseSeverity(top.abs);
  const signWord = top.value < 0 ? "low" : "high";
  return `${sev} ${signWord} on ${top.label}`;
}

export function communityBoldnessHint(
  spreadRows: Array<{ positionBand?: string | null }>
): string {
  const extreme = spreadRows.filter(
    (r) => r.positionBand === "below_typical" || r.positionBand === "above_typical"
  ).length;
  if (extreme >= 4) {
    return "Several parameters already sit outside community typical bands — prefer smaller reversible moves unless rating is very low.";
  }
  if (extreme === 0) {
    return "Setup sits near community medians — magnitude can follow symptom severity.";
  }
  return "Use community spread to avoid pushing parameters that are already atypical.";
}
