/**
 * The demo walkthrough's stops — pure data, NO React, NO Prisma, NO Next imports, so this
 * unit-tests the same way `demoAccess.ts` does (`npm run test:demo-tour`).
 *
 * Who sees it: demo sessions only. `docs/ONBOARDING_NORTH_STAR.md` rejected coachmarks for
 * real users ("Rejected in favour of doing the work with the driver, then one quiet line per
 * step") and that still stands — a new driver's app is EMPTY, so a tour there would point at
 * empty states. A demo visitor's app is full of somebody's seeded season, which is the one
 * condition under which a walkthrough has anything to point at.
 *
 * ── Two copy rules, both load-bearing ────────────────────────────────────────
 *
 * 1. Every `title` is the label that is on screen beside the cutout. Stop 4 is
 *    "Session details" because that is the eyebrow `RunDetailPanel` opens with; stop 3 is
 *    "Sessions"; stop 7 is "Ideas". A walkthrough that renames what it points at loses
 *    the reader the moment it ends and they go looking for the thing it described.
 *
 * 2. No season data in the copy. A draft put the real run/track counts into the titles
 *    ("34 runs. 3 tracks. 8 months.") — cut as marketing, and cutting it means the tour reads
 *    NO data at all. That is why this file is static strings and why `DemoTour` needs nothing
 *    threaded down from a server component.
 */

export type TourViewport = "mobile" | "desktop";

export type TourPlacement = "top" | "bottom" | "left" | "right";

/**
 * How a stop's destination is worked out.
 *
 * `static` — `route` is the whole answer.
 * `run-detail` — the destination is one driver's run page, whose id is only known at runtime.
 *   The controller reads the first `/runs/<id>` link out of the Sessions list it is already
 *   standing on and pushes that; if the season has no runs, the stop is skipped rather than
 *   guessed at. Nothing is fetched — the href is already rendered on screen.
 */
export type TourRouteKind = "static" | "run-detail";

export type TourStep = {
  /** Stable across copy edits — this is what `sessionStorage` resumes on. */
  id: string;
  /**
   * Where the stop lives. A record when the viewports genuinely differ; today they never do,
   * but the shape is kept because `navConfig` already routes Analysis to two destinations
   * (`/analysis` on the phone, `/runs/history` at md+) and a future stop may follow it.
   *
   * For a `run-detail` step this is the route the link is READ FROM, not the destination.
   */
  route: string | Record<TourViewport, string>;
  routeKind?: TourRouteKind;
  /**
   * Ordered `data-tour` candidates — the first one actually VISIBLE wins.
   *
   * An array, not a string, and that is load-bearing twice over:
   *   · the dashboard renders `DashboardDesktop` (`hidden xl:grid`) AND the phone stack
   *     (`xl:hidden`) at the same time, so one id genuinely matches two live nodes;
   *   · the anchor ids predate the 2026-08-18 rename to "Ideas" and are deliberately left
   *     alone — they are internal, and `TOUR_ANCHOR_IDS` pins them.
   * Ordered candidates plus a visibility filter resolve both without a conditional in here.
   */
  anchors: readonly string[];
  title: string;
  body: string;
  placement: Record<TourViewport, TourPlacement>;
  /** Absent ⇒ both viewports. */
  viewports?: readonly TourViewport[];
  /** Extra px around the cutout. Defaults to `DEFAULT_TOUR_PADDING`. */
  padding?: number;
  /**
   * Release the scrim so the element inside the cutout is usable. Exactly one stop sets this
   * (the Engineer composer) — see `DemoTour` for why the app is otherwise inert.
   */
  handover?: boolean;
};

export const DEFAULT_TOUR_PADDING = 8;

/**
 * The viewport split is **xl (1280px)**, NOT `md`.
 *
 * It has to match the `DashboardHome` / `DashboardDesktop` twin-render boundary, because that
 * is what decides which of the two live `data-tour="log-run"` nodes is the visible one. The
 * sidebar rail appears at `md`, which is a different question and not this one.
 */
export const TOUR_DESKTOP_MIN_WIDTH = 1280;

const SESSIONS_ROUTE = "/runs/history";

/**
 * Prefix a `run-detail` step's resolved destination must match, so `isOnStepRoute` can tell
 * "we arrived" from "we are still on the list". `/runs/new` and `/runs/history` are excluded
 * by `isRunDetailPath` below — both start `/runs/` and neither is a run.
 */
const RUN_DETAIL_PREFIX = "/runs/";

/** Is this pathname a single run's page, rather than the list or the log form? */
export function isRunDetailPath(pathname: string): boolean {
  if (!pathname.startsWith(RUN_DETAIL_PREFIX)) return false;
  const rest = pathname.slice(RUN_DETAIL_PREFIX.length);
  if (!rest || rest.includes("/")) return false; // `/runs/<id>/edit` is not the read view
  return rest !== "new" && rest !== "history";
}

export const DEMO_TOUR_STEPS: readonly TourStep[] = [
  {
    id: "log-run",
    route: "/",
    anchors: ["log-run"],
    title: "Log a run",
    body: "Records one session: car, tires, and track conditions. Lap times attach to the run automatically.",
    // Desktop: the CTA sits in the 420px right column, so the popover goes left of it.
    placement: { desktop: "left", mobile: "bottom" },
  },
  {
    id: "day-read",
    route: "/",
    anchors: ["day-read"],
    title: "The day's summary",
    body: "Best lap, how the fastest laps clustered, and the handling ratings given. Calculated from the runs logged that day.",
    placement: { desktop: "right", mobile: "bottom" },
    // The desktop hero has no phone equivalent by design — `DashboardHome`'s header says so
    // outright ("the hero has no phone equivalent"). The phone therefore gets six stops.
    viewports: ["desktop"],
  },
  {
    id: "sessions",
    route: SESSIONS_ROUTE,
    anchors: ["sessions"],
    title: "Sessions",
    body: "Every logged run, newest first. Select one to see its lap times and the setup it ran.",
    placement: { desktop: "right", mobile: "bottom" },
  },
  {
    id: "run-detail",
    /*
     * Opens one run's own page.
     *
     * This is NOT a second anchor on the Sessions route, which an earlier draft assumed. The
     * Sessions accordion expands to a `RunHistoryTable` — a table of run ROWS — while the full
     * record (`RunDetailPanel`: Session details, Laptimes, Setup vs previous run, Notes) lives
     * on `/runs/[id]` via `RunPageClient`, and in the desktop workbench pane once a run is
     * picked. Pointing at the expanded accordion would have shown a row list and called it the
     * run's details.
     *
     * `/runs/[id]` is used on both viewports because it renders the same `RunDetailPanel`
     * either way, and the id is discovered from the list the previous stop is already showing.
     */
    route: SESSIONS_ROUTE,
    routeKind: "run-detail",
    anchors: ["run-detail"],
    title: "Session details",
    body: "The full record of one run: car, tires and prep, the lap figures, the setup values that changed since the run before, and the notes.",
    // The anchor is the whole `RunDetailPanel`, which on a phone is taller than the viewport.
    // `useTourPlacement` top-aligns an over-tall anchor rather than centring it; see there.
    placement: { desktop: "left", mobile: "top" },
  },
  {
    id: "engineer-composer",
    route: "/engineer",
    anchors: ["engineer-composer"],
    title: "Ask a question",
    body: "Describe the handling in plain words. The answer names one change to make and the reason for it. The demo allows two questions a day.",
    placement: { desktop: "top", mobile: "top" },
    handover: true,
  },
  {
    id: "test-plan",
    route: "/",
    anchors: ["test-plan", "things-to-try"],
    title: "Ideas",
    body: "Changes worth trying are kept here and carried through to the next time out.",
    placement: { desktop: "left", mobile: "top" },
  },
];

/**
 * Every `data-tour` value the steps can ask for. The unit test asserts the two lists agree, so
 * a renamed anchor that misses its host component fails `npm run test:demo-tour` rather than
 * silently degrading to the "anchor never appeared" fallback in front of a visitor.
 */
export const TOUR_ANCHOR_IDS = [
  "log-run",
  "day-read",
  "sessions",
  "run-detail",
  "engineer-composer",
  "test-plan",
  "things-to-try",
] as const;

export type TourAnchorId = (typeof TOUR_ANCHOR_IDS)[number];

/** The stops that exist on this viewport, in order. */
export function stepsForViewport(
  viewport: TourViewport,
  steps: readonly TourStep[] = DEMO_TOUR_STEPS,
): TourStep[] {
  return steps.filter((step) => !step.viewports || step.viewports.includes(viewport));
}

/** The route a stop wants, resolved for this viewport. */
export function routeForStep(step: TourStep, viewport: TourViewport): string {
  return typeof step.route === "string" ? step.route : step.route[viewport];
}

/**
 * Does `pathname` already satisfy this step?
 *
 * Compares the PATH only, so a query string never reads as a route change and re-pushes on
 * every render. A `run-detail` step is satisfied by ANY single run's page — the tour does not
 * care which run it landed on, only that it is looking at one.
 */
export function isOnStepRoute(
  step: TourStep,
  viewport: TourViewport,
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  if (step.routeKind === "run-detail") return isRunDetailPath(pathname);
  return pathname === routeForStep(step, viewport);
}

/** Viewport from a measured width. Exported so the test can pin the boundary. */
export function viewportForWidth(width: number): TourViewport {
  return width >= TOUR_DESKTOP_MIN_WIDTH ? "desktop" : "mobile";
}
