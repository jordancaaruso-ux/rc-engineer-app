/**
 * Carrying one corrected setup value forward to the runs that inherited the mistake.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * A wrong number on a setup sheet is almost never wrong for one run. The driver
 * turned a screw at the track and didn't update the sheet, so every run logged
 * from that point carries the value the car stopped having. Correcting them one
 * at a time is the same edit typed ten times, and the tenth one gets skipped —
 * which is worse than not correcting at all, because now the history disagrees
 * with itself and the Engineer reads both halves.
 *
 * So a correction offers to travel. The driver still confirms it: this file only
 * decides what is TICKED when the question appears, never what is written.
 *
 * ============================== WHY IT STOPS AT THE FIRST DISAGREEMENT ==============================
 *
 * Four rules were prototyped against real run data (sandbox, 2026-08-20). The
 * one that survives is: walk out from the corrected run and stop at the first
 * run whose value is something else.
 *
 * The runs that still hold the old value are the ones that inherited the
 * mistake — they were prefilled from the run before them and nobody touched the
 * field. The first run that holds a DIFFERENT value is the driver actually
 * entering something, and the correction has no business reaching past it: at
 * that point the sheet and the car agree again, and everything after it descends
 * from a number that was typed on purpose.
 *
 * ============================== THE WALK RUNS BOTH WAYS ==============================
 *
 * Forward only until 2026-08-21. The founder asked for earlier runs as well, and
 * the case is easy to see: correct the NEWEST run on a car and there is nothing
 * after it, so the question could never fire at all — which is precisely when a
 * driver has just noticed the sheet has been wrong for a while.
 *
 * The rule above needs no change to run backwards. "Stop at the first run holding
 * a genuine third value" reads the same in both directions: going back, that run
 * is where the value was last set on purpose, so the mistake cannot pre-date it.
 * `planSetupCorrection` therefore takes ONE sequence, ordered nearest-to-the-
 * correction-first, and the caller decides which way it points.
 *
 * What does differ is what the driver is offered. Forward, a run holding the old
 * value demonstrably inherited it, so it is TICKED. Backward, the app is guessing
 * at intent rather than reading inheritance — "it has been wrong all along" and
 * "I fixed this one run" look identical from here — so earlier runs are listed
 * and left for the driver to tick (founder call: "show them until the time it's
 * changed, no tick"). That is `defaultPicked`'s only asymmetry, and it lives in
 * the caller rather than here.
 *
 * A run that ALREADY holds the corrected value does not stop the walk. It is
 * evidence for the correction, not against it — usually a run the driver already
 * fixed by hand before giving up and asking the app to do the rest. Only a run
 * holding a genuine third value ends the chain.
 *
 * The rejected alternatives, so they don't get re-proposed:
 *
 *   - "every later run" — reaches past a deliberate change and silently rewrites
 *     it, which is the one outcome that loses data the driver can't get back.
 *   - "every later run still holding the old value" — looks careful, but it JUMPS
 *     a deliberate change to grab runs beyond it. A value that came back to 5.0
 *     after a week at 5.5 got there on purpose.
 *   - "this event only" — stops at a boundary the mistake doesn't respect. A
 *     sheet that was wrong on Saturday is still wrong on Wednesday.
 *
 * Every later run is still LISTED and still tickable by hand. The rule chooses
 * the default, and the default is the conservative reading: only the runs that
 * demonstrably inherited the value, and only up to the point where the driver
 * last had an opinion.
 */

import { compareSetupField } from "@/lib/setupCompare/compare";

/**
 * How many corrected values one save may ask about, one question at a time.
 *
 * Three, because spotting two or three stale numbers on the same sheet and fixing them
 * together is an ordinary correction, while a page of boxes is a driver redoing the setup.
 * Founder call, 2026-08-21 — it was 1, and two boxes silently bought you nothing.
 */
export const MAX_CASCADE_QUESTIONS = 3;

/** One neighbouring run, with whatever it currently holds for the key. */
export type LaterRunForCorrection = {
  id: string;
  /** Raw snapshot value — compared with the same semantics the diff table uses. */
  value: unknown;
};

export type SetupCorrectionCandidate = {
  runId: string;
  /**
   * For the picker's "says …" column. Normalized the same way the "Setup vs
   * previous run" table normalizes, so one value doesn't read two ways in two
   * places on the same screen (`5.0` on the sheet is `5` in both).
   */
  displayValue: string;
  /** This run still carries the value that was just corrected away from. */
  holdsOldValue: boolean;
  /** This run already carries the corrected value — ticking it writes nothing. */
  alreadyCorrect: boolean;
  /** Ticked when the question opens. See the header for the rule. */
  defaultPicked: boolean;
  /**
   * This run is where the walk stopped — it holds a third value, so it was typed on
   * purpose and the mistake cannot reach past it.
   *
   * It is not a candidate, but the sheet shows it anyway on the earlier side, because a
   * backward list that just ends looks truncated. Shown, it explains itself.
   */
  stopsWalk: boolean;
};

/**
 * The candidate list for a correction, walking ONE way from the corrected run.
 *
 * `runs` MUST be ordered NEAREST TO THE CORRECTION FIRST and scoped to the same
 * car: the walk depends on that order, and the stop condition is meaningless
 * across cars. Going forward that is `sortAt` ascending; going backward it is
 * `sortAt` descending. The rule itself does not care which — see the header.
 */
export function planSetupCorrection(input: {
  key: string;
  /** What the corrected run held BEFORE the edit. */
  previousValue: unknown;
  /** What it holds now. */
  nextValue: unknown;
  runs: readonly LaterRunForCorrection[];
  /**
   * Whether a run the walk reaches arrives ticked. False for the backward walk, where
   * reaching a run is a guess at intent rather than evidence of inheritance.
   */
  tickReached?: boolean;
}): SetupCorrectionCandidate[] {
  const { key, previousValue, nextValue, tickReached = true } = input;
  const candidates: SetupCorrectionCandidate[] = [];
  let stillWalking = true;

  for (const run of input.runs) {
    const vsOld = compareSetupField({ key, a: run.value, b: previousValue });
    const vsNew = compareSetupField({ key, a: run.value, b: nextValue });
    const holdsOldValue = vsOld.areEqual;
    const alreadyCorrect = vsNew.areEqual;

    // The walk ends at the first run holding a third value — that run is excluded
    // too, because it is the deliberate change, not a victim of the stale sheet.
    // A run already carrying the correction is transparent to the walk.
    const stopsWalk = stillWalking && !holdsOldValue && !alreadyCorrect;
    if (stopsWalk) stillWalking = false;

    candidates.push({
      runId: run.id,
      displayValue: vsOld.normalizedA,
      holdsOldValue,
      alreadyCorrect,
      defaultPicked: tickReached && stillWalking && !alreadyCorrect,
      stopsWalk,
    });
  }

  return candidates;
}

/**
 * True when a correction is worth asking about at all.
 *
 * ============================== WHY THIS IS NOT "SOMETHING IS TICKED" ==============================
 *
 * It was exactly that until 2026-08-21, and the backward walk broke it: earlier runs are
 * never ticked by design, so a correction whose only reach was backward got planned in full
 * and then thrown away by this line — silent, and precisely in the case the founder asked
 * for (fix the newest run on a car; there is nothing after it).
 *
 * So the test is "is there a run this correction could plausibly travel to". A run that
 * already holds the corrected value is not one: ticking it writes nothing, and a sheet of
 * those is a screen of rows the driver must decline, which teaches them to decline the one
 * that matters. Neither is the run that stopped the walk — it is shown for context, not
 * offered.
 */
export function correctionHasSomethingToOffer(
  candidates: readonly SetupCorrectionCandidate[]
): boolean {
  return candidates.some((c) => !c.alreadyCorrect && !c.stopsWalk);
}
