/**
 * Display notes for a run: prefer unified `notes`, else merge legacy fields.
 */
export function displayRunNotes(run: {
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
