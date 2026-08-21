import type { CorrectionCandidate } from "@/components/runs/SetupCorrectionSheet";

/**
 * The "did your other runs have this wrong too?" questions, handed from the setup sheet
 * back to the run they came from.
 *
 * ============================== WHY IT IS HANDED OVER AT ALL ==============================
 *
 * The question is asked on the RUN page — it is about that run's neighbours, and the
 * sheet editor is a different page that knows nothing about them. Until 2026-08-20 that
 * was fine, because a setup value was corrected by a text box on the run page itself. Now
 * it is corrected on the sheet, so the answer arrives on one page and the question belongs
 * on another.
 *
 * This is the GARAGE path. When the correction happens in the run page's own setup pop-up
 * there is no navigation at all and the questions are handed straight across in memory —
 * see `SetupSheetModal`. This stash exists for the door that still travels.
 *
 * ============================== WHY SESSION STORAGE AND NOT THE URL ==============================
 *
 * The payload is a field, two values and a list of candidate runs — far past what belongs
 * in a query string, and it would sit in the address bar and in history afterwards. The
 * two pages are the same tab in the same session, which is exactly what `sessionStorage`
 * is for, and a soft `router.push` preserves it.
 *
 * It is written immediately before navigating and READ ONCE, then cleared — so a driver
 * who wanders off instead of going back to the run never finds the question waiting for
 * them later. It is keyed by run id as well, so it can never fire on a different run than
 * the one it was recorded for (the Sessions workbench mounts this panel per row).
 *
 * ============================== WHY IT IS A LIST ==============================
 *
 * One save may correct up to `MAX_CASCADE_QUESTIONS` boxes (2026-08-21), each with its own
 * neighbours to ask about, so the payload carries every question and the run page asks them
 * in turn. It was a single correction while only one box could qualify.
 */

const KEY = "rc:pending-setup-cascade";

export type PendingSetupCascadeItem = {
  field: { key: string; label: string };
  previousDisplay: string;
  nextDisplay: string;
  candidates: CorrectionCandidate[];
};

export type PendingSetupCascade = {
  runId: string;
  corrections: PendingSetupCascadeItem[];
};

export function stashPendingSetupCascade(value: PendingSetupCascade): void {
  if (typeof window === "undefined") return;
  if (value.corrections.length === 0) return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Private mode, quota, a webview with storage disabled. The correction itself has
    // already been saved; only the follow-up question is lost, so this must never throw.
  }
}

/** Reads and clears. Returns null unless the stash is for exactly this run. */
export function takePendingSetupCascade(runId: string): PendingSetupCascade | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSetupCascade;
    if (!parsed || parsed.runId !== runId) return null;
    window.sessionStorage.removeItem(KEY);
    if (!Array.isArray(parsed.corrections)) return null;
    /*
     * Every item validated, not just the payload's shape. A stash written by a previous
     * deploy is the realistic bad input here — this survives a soft navigation, so a driver
     * mid-correction while a release lands really can read one back.
     */
    const corrections = parsed.corrections.filter(
      (c) => c && c.field?.key && Array.isArray(c.candidates)
    );
    if (corrections.length === 0) return null;
    return { runId: parsed.runId, corrections };
  } catch {
    return null;
  }
}
