/**
 * Lets a row that is holding unsaved setup work stop the LIST above it from folding it away.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * The setup sheet is filled in place now — inside `RunFaces`, on the Setup face — so the driver
 * types into a pop-up-free editor that lives in an ordinary expanded row. `RunFaces` guards its
 * own exits (the Edit toggle, switching to another face) exactly as `SetupSheetModal` guards its
 * four, but the biggest exit of all is not its to guard: tapping the row's own header collapses
 * the row, `RunFaces` simply stops being rendered, and the typing goes with it. That header
 * button belongs to `SessionsBrowser` and `AnalysisOutingCard`, which know nothing about setups.
 *
 * The lists cannot ask the question themselves — the words, the count and the save door are the
 * editor's, not theirs — so the row registers the question here and the list asks for it. Same
 * shape as the pop-up's own exits, same `ExitPromptSheet`, one place to change it.
 *
 * A module-level map rather than a context: the two lists and the row are already assembled by
 * three different files, and this is one boolean per open run — a provider around both lists
 * would be a lot of wiring for a fact that lives on a single row at a time.
 */

/** Asks the driver, then calls `proceed` if they chose to leave. Never call `proceed` twice. */
type ExitAsk = (proceed: () => void) => void;

const asks = new Map<string, ExitAsk>();

/**
 * Called by the open row while — and only while — it is holding unsaved setup work. Passing null
 * withdraws the question, which every clean render and every unmount must do: a stale entry would
 * make a row that has nothing to lose refuse to close.
 */
export function registerRunSetupExitAsk(runId: string, ask: ExitAsk | null): void {
  if (ask) asks.set(runId, ask);
  else asks.delete(runId);
}

/**
 * Called by a list about to collapse a row.
 *
 * Returns true when the question has been ASKED and the caller must do nothing else — the row
 * will run `proceed` itself if the driver decides to leave. False means nothing is at stake and
 * the caller should collapse the row as usual.
 */
export function requestRunSetupExit(runId: string, proceed: () => void): boolean {
  const ask = asks.get(runId);
  if (!ask) return false;
  ask(proceed);
  return true;
}
