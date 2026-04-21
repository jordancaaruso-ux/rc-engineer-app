import { formatHandlingAssessmentForEngineer } from "@/lib/runHandlingAssessment";

/**
 * Single effective notes string for Engineer interpretation (Phase 2 policy).
 * Priority: unified notes, then driver notes, then handling problems.
 * Appends structured handling assessment when present.
 */
export function getEffectiveRunNotes(input: {
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  handlingAssessmentJson?: unknown;
}): string {
  const a = input.notes?.trim();
  const base = a
    ? a
    : input.driverNotes?.trim()
      ? input.driverNotes.trim()
      : input.handlingProblems?.trim() ?? "";
  const extra = formatHandlingAssessmentForEngineer(input.handlingAssessmentJson);
  if (!extra) return base;
  if (!base.trim()) return extra;
  return `${base}\n\n${extra}`;
}
