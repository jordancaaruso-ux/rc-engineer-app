import { formatHandlingAssessmentForEngineer } from "@/lib/runHandlingAssessment";

/**
 * Session notes only (unified or legacy merge), **without** structured handling assessment.
 * Use for Engineer context `notesPreview` so long notes don’t truncate away handling.
 */
export function displayRunNotesTextOnly(run: {
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
}): string {
  const unified = run.notes?.trim();
  if (unified) return unified;
  const d = run.driverNotes?.trim();
  const h = run.handlingProblems?.trim();
  if (d && h) return `${d}\n\n— Handling —\n${h}`;
  return d || h || "";
}

/**
 * Display notes for a run: prefer unified `notes`, else merge legacy fields.
 * Appends structured handling assessment when present.
 */
export function displayRunNotes(run: {
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  handlingAssessmentJson?: unknown;
}): string {
  const unified = run.notes?.trim();
  let base: string;
  if (unified) {
    base = unified;
  } else {
    const d = run.driverNotes?.trim();
    const h = run.handlingProblems?.trim();
    if (d && h) base = `${d}\n\n— Handling —\n${h}`;
    else base = d || h || "";
  }
  const extra = formatHandlingAssessmentForEngineer(run.handlingAssessmentJson);
  if (!extra) return base;
  if (!base.trim()) return extra;
  return `${base}\n\n${extra}`;
}
