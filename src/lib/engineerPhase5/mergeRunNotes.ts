/**
 * Single effective notes string for Engineer interpretation (Phase 2 policy).
 * Priority: unified notes, then driver notes, then handling problems.
 */
export function getEffectiveRunNotes(input: {
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
}): string {
  const a = input.notes?.trim();
  if (a) return a;
  const b = input.driverNotes?.trim();
  if (b) return b;
  return input.handlingProblems?.trim() ?? "";
}
