/**
 * The door into the wizard for a run the app filed from the timing sheet ("Add N other runs
 * from today"), and where a save through it lands.
 *
 * Two surfaces send a driver here: the lap picker, when the session they pick is already on an
 * unconfirmed run ("Open"), and the edit page's own default when nobody said where to go back
 * to. Both used to end on the dashboard with a `?suggestRun` nudge meant for a run just logged,
 * which for a confirmed run from last month suggested nothing — and five unconfirmed runs meant
 * five trips back to the day (found driving it, 2026-09-14). The Sessions list opened on this
 * run's group is where the rest of that day's unconfirmed runs are.
 */
export function confirmRunReturnHref(runId: string): string {
  // `level=day` stops the back trip at the day's list (Sessions reads it): the run just
  // confirmed is a row there, and so are the day's other unconfirmed runs with their Confirm.
  // A plain `openGroup` goes one level deeper, to the run itself.
  return `/runs/history?openGroup=${encodeURIComponent(runId)}&level=day`;
}

export function confirmRunHref(runId: string): string {
  const id = encodeURIComponent(runId);
  return `/runs/${id}/edit?back=${encodeURIComponent(confirmRunReturnHref(runId))}`;
}
