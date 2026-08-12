/**
 * Where the demo walkthrough keeps its place, and how the demo banner restarts it.
 *
 * `sessionStorage`, not the database, and that is forced rather than chosen: the demo account
 * is SHARED, and middleware 403s every non-GET a demo session makes (`demoAccess.ts`). A tour
 * that tried to record "seen" server-side would not only fail, it would trip the banner's
 * fetch wrapper and pop "The demo is read-only" over the tour itself.
 *
 * Same storage-write + `window.dispatchEvent` shape as `engineerSessionsTargetStorage.ts` and
 * `activeSetupContext.ts`. A React context would be the other option, but `DemoBanner` renders
 * in BOTH `AppShell` branches while `DemoTour` renders in only one, so a provider would have to
 * wrap the entire shell to serve a single button.
 *
 * Every access is wrapped, including reads: Safari private mode and some embedded webviews
 * throw on `sessionStorage` outright. When that happens the tour degrades to in-memory state —
 * it runs once per page load and cannot be permanently dismissed. Accepted; the alternative is
 * a crash on the app's first impression.
 */

/** Matches the `jrc-demo-return` convention `DemoBanner` already uses. */
export const DEMO_TOUR_STORAGE_KEY = "jrc-demo-tour";

/** Banner → tour. Fired by `requestDemoTourStart`. */
export const DEMO_TOUR_START_EVENT = "jrc-demo-tour-start";

export type DemoTourStatus = "unseen" | "running" | "done";

export type DemoTourState = {
  status: DemoTourStatus;
  /** Index into `stepsForViewport(...)`, so a hard navigation resumes on the right stop. */
  stepIndex: number;
};

const INITIAL: DemoTourState = { status: "unseen", stepIndex: 0 };

/** Set only when storage throws, so a blocked-storage visitor still gets a working tour. */
let memoryFallback: DemoTourState | null = null;

function isStatus(value: unknown): value is DemoTourStatus {
  return value === "unseen" || value === "running" || value === "done";
}

export function readTourState(): DemoTourState {
  if (typeof window === "undefined") return INITIAL;
  try {
    const raw = window.sessionStorage.getItem(DEMO_TOUR_STORAGE_KEY);
    if (!raw) return memoryFallback ?? INITIAL;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return INITIAL;
    const { status, stepIndex } = parsed as Partial<DemoTourState>;
    // Anything malformed reads as a fresh tour rather than throwing on a first impression.
    if (!isStatus(status)) return INITIAL;
    const index = typeof stepIndex === "number" && Number.isInteger(stepIndex) && stepIndex >= 0
      ? stepIndex
      : 0;
    return { status, stepIndex: index };
  } catch {
    return memoryFallback ?? INITIAL;
  }
}

export function writeTourState(next: DemoTourState): void {
  if (typeof window === "undefined") return;
  memoryFallback = next;
  try {
    window.sessionStorage.setItem(DEMO_TOUR_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — `memoryFallback` already holds it for this page load */
  }
}

/** Called before every route push, so a wedged navigation resumes on the right stop. */
export function markTourRunning(stepIndex: number): void {
  writeTourState({ status: "running", stepIndex });
}

/** Skip, Escape, or the last stop's Done. */
export function markTourDone(): void {
  writeTourState({ status: "done", stepIndex: 0 });
}

/**
 * The demo banner's "Take the tour". Restarts from stop 0 regardless of a prior `done`, and
 * the tour's own listener handles routing back to the first stop's page if needed.
 */
export function requestDemoTourStart(): void {
  if (typeof window === "undefined") return;
  markTourRunning(0);
  try {
    window.dispatchEvent(new Event(DEMO_TOUR_START_EVENT));
  } catch {
    /* nothing to do — the tour will pick the state up on its next mount */
  }
}

/**
 * Dev/test override read once on mount from the real URL.
 *
 * `?tour=1` forces the tour on — for demo sessions anywhere, and for ANY session outside
 * production, which is what lets the whole walkthrough be driven on a normal dev account
 * across real routes with real data, with no seeded demo and no env vars.
 * `?tour=0` suppresses auto-start, which the existing Playwright specs need so the scrim
 * cannot cover their screenshots.
 *
 * Deliberately reads `window.location.search` rather than `useSearchParams()`: that hook opts
 * its subtree into a client-side bailout on otherwise-static routes, and `DemoTour` mounts
 * inside `AppShell` on every page in the app.
 */
export function readTourUrlOverride(): "force" | "suppress" | null {
  if (typeof window === "undefined") return null;
  try {
    const value = new URLSearchParams(window.location.search).get("tour");
    if (value === "1") return "force";
    if (value === "0") return "suppress";
    return null;
  } catch {
    return null;
  }
}

/** Test seam — resets the in-memory fallback between cases. */
export function __resetDemoTourMemory(): void {
  memoryFallback = null;
}
