import { revalidatePath, revalidateTag } from "next/cache";
import { carsTag, dashboardTag, runsTag, tracksTag } from "@/lib/cacheTags";

const IMMEDIATE = { expire: 0 } as const;

export function revalidateAfterRunMutation(userId: string): void {
  revalidatePath("/runs/history");
  revalidatePath("/");
  revalidatePath("/engineer");
  revalidatePath("/laps/analysis");
  // A new run moves three of the four Tools bands at once: it is the geometry band's source,
  // half the compare pair, and — when the run was logged from an import — the reason a session
  // leaves the lap-import band. `runsTag` below busts the cached model; this busts the route.
  revalidatePath("/tools");
  /*
   * `/analysis` appeared in no revalidation list anywhere in the app until 2026-08-24 — the only
   * main surface missing one. The tag below busts the cached model, which is not enough on its
   * own: `staleTimes.dynamic: 30` (next.config.mjs) lets the browser reuse a page it already
   * holds for 30s without asking the server at all, and only `revalidatePath` drops that copy.
   *
   * So a lap change landing WITHOUT a full document load — the lap importer, the detected-run
   * prompt, anything attaching laps to a run that already exists — left Recent runs quoting the
   * old numbers for up to half a minute, a dash where a best lap belonged, until the driver
   * refreshed. The log-run wizard masked it: it exits via `window.location.assign`, which wipes
   * the client cache outright, so the path most runs are logged through always looked correct.
   *
   * Same failure the event mutation below was fixed for, and the same one-line shape of fix.
   */
  revalidatePath("/analysis");
  revalidateTag(dashboardTag(userId), IMMEDIATE);
  revalidateTag(runsTag(userId), IMMEDIATE);
}

export function revalidateAfterActionItemMutation(userId: string): void {
  revalidatePath("/");
  revalidatePath("/runs/new");
  revalidatePath("/engineer");
  revalidateTag(dashboardTag(userId), IMMEDIATE);
}

export function revalidateAfterCarMutation(userId: string): void {
  revalidatePath("/cars");
  revalidatePath("/runs/new");
  revalidateTag(carsTag(userId), IMMEDIATE);
  revalidateTag(dashboardTag(userId), IMMEDIATE);
}

/**
 * Booking, editing or joining a meeting.
 *
 * Event mutations used to revalidate nothing, and that was correct: `/events` is
 * `force-dynamic` and the dashboard's next-outing card rides the dashboard tag. Paddock
 * changed it — its hero IS the next meeting and the model is cached for 30s, so without
 * this a driver books a meeting and the tab still says "No meeting planned" for half a
 * minute (measured 2026-08-18).
 */
export function revalidateAfterEventMutation(userId: string): void {
  revalidatePath("/events");
  revalidatePath("/paddock");
  revalidatePath("/");
  revalidateTag(dashboardTag(userId), IMMEDIATE);
}

export function revalidateAfterTrackMutation(userId: string): void {
  revalidatePath("/tracks");
  revalidatePath("/runs/new");
  revalidatePath("/events");
  revalidateTag(tracksTag(userId), IMMEDIATE);
}
