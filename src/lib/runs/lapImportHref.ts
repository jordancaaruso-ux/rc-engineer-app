/**
 * The door into the wizard's lap importer for a run that already exists.
 *
 * ============================== WHY IT IS ONE FUNCTION ==============================
 *
 * Five surfaces send a driver to import or replace a run's lap times — the session view,
 * three places in the Sessions table, the Sessions workbench, and the dashboard's
 * "no lap times yet" card. All five want the same thing and all five were writing the
 * query string by hand.
 *
 * Four of them wrote it WITHOUT `back=`, and the fifth wrote it with a `back=` that
 * nothing read. So every one of them ended the same way: the driver imported their heat,
 * pressed save, and was handed the dashboard. `/runs/[id]/edit` reads the param now (see
 * `safeAppPath` there), which is what makes this href a round trip rather than a one-way
 * street.
 *
 * ============================== WHY IT ALWAYS RETURNS TO THE RUN ==============================
 *
 * Not to whichever list the driver pressed it from. They came to attach lap times to one
 * session, and the session is where those lap times now are — landing on the list would
 * mean the one thing they just did is off screen. Every one of those lists is one tap away
 * from the run page's own back arrow.
 */
export function lapImportHref(runId: string): string {
  const id = encodeURIComponent(runId);
  return `/runs/${id}/edit?step=laps&back=${encodeURIComponent(`/runs/${runId}`)}`;
}
