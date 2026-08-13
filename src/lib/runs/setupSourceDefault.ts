/**
 * Which face the log-run wizard's Setup step opens on (founder call 2026-08-13).
 *
 * The step offers three sources — the car's previous runs, its saved setups, or a
 * new blank sheet — and the right one to land on depends entirely on what that car
 * actually has. Landing on "New" for a car with a season of history is the common
 * case done wrong, so the rule is:
 *
 *     previous runs → saved setups → new
 *
 * The last run's setup wins because that is where the car physically is. "New" is
 * the answer only for a car with nothing behind it at all — which is the first-run
 * case this was originally written for (measured 2026-08-13: ten of ten new
 * accounts landed on an empty "Previous runs" and a screenful of blank space).
 *
 * Two invariants the caller must preserve, both founder decisions:
 *
 *  - **The face moves; nothing else does.** No run is selected, no setup is
 *    attached, no baseline is set and the sheet is not expanded. Carrying a setup
 *    forward stays the job of the explicit prefill / copy-last-run tap — see
 *    `LogRunWizardHost`: "prefill should always be an option — never automatic".
 *  - **An empty list is only evidence when the request came back.** A failed or
 *    in-flight fetch must never read as "this car has nothing", because the cost of
 *    being wrong is landing an established driver on a blank sheet.
 *
 * Kept pure and out of the component so the rule can be tested directly — the same
 * reason `carSwap.ts` and `onboarding/visibility.ts` live where they do.
 */

export type SetupSource = "previous_runs" | "other" | "new";

/**
 * What is known about one of the two per-car option lists.
 *
 * `unknown` covers both "still loading" and "the request failed" on purpose: they
 * are the same thing to this decision, which is that the list carries no evidence
 * either way.
 */
export type SetupListState = "unknown" | "empty" | "present";

export function setupListState(args: {
  /** The lists in hand belong to the car being asked about. */
  loadedForThisCar: boolean;
  /** The request for this list resolved (as opposed to failing). */
  ok: boolean;
  count: number;
}): SetupListState {
  if (!args.loadedForThisCar || !args.ok) return "unknown";
  return args.count > 0 ? "present" : "empty";
}

/**
 * The priority ladder. `null` means "not enough is known — leave the face alone".
 *
 * Note the asymmetry: a `present` runs list answers the question on its own, so a
 * saved-setups list that failed to load cannot block the right answer. But an
 * `unknown` runs list stops everything, because promoting "Saved" or "New" over a
 * previous-runs list that simply hasn't arrived is exactly the downgrade this rule
 * exists to prevent.
 */
export function preferredSetupSource(
  previousRuns: SetupListState,
  savedSetups: SetupListState
): SetupSource | null {
  if (previousRuns === "present") return "previous_runs";
  if (previousRuns === "unknown") return null;
  if (savedSetups === "present") return "other";
  if (savedSetups === "unknown") return null;
  return "new";
}

/**
 * The whole rule, as the form runs it. Returns the face to land on, or `null` for
 * "do not move".
 *
 * The four suppressions are each a case where an answer already exists and the
 * default would be talking over it.
 */
export function resolveSetupSourceDefault(input: {
  previousRuns: SetupListState;
  savedSetups: SetupListState;
  /** Editing a run or resuming a draft — the source was settled when it was saved. */
  isEditing: boolean;
  /** The driver has picked a face, a run or a saved setup *for this car*. */
  driverChoseForThisCar: boolean;
  /** The default already landed for this car. It lands once; a later list refresh
   *  (an upload finishing, say) must not move the face out from under the driver. */
  alreadyDefaultedForThisCar: boolean;
  /** Something is already on the sheet — a wizard prefill, a copied run, or the
   *  restored local draft, none of which record a source of their own. */
  sheetHasContent: boolean;
}): SetupSource | null {
  if (input.isEditing) return null;
  if (input.driverChoseForThisCar) return null;
  if (input.alreadyDefaultedForThisCar) return null;
  if (input.sheetHasContent) return null;
  return preferredSetupSource(input.previousRuns, input.savedSetups);
}
