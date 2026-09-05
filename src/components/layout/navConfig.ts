import {
  IconAddRun,
  IconAnalysis,
  IconDashboard,
  IconEngineer,
  IconGarage,
  IconSettings,
  IconTools,
  type JrcIcon,
} from "@/components/icons/JRCIcons";

/**
 * `paddock` replaced `assets`, `events` and `more` in the 2026-08-18 restructure.
 *
 * Those were three ids for one idea — the things a run points at — split across a dock cell,
 * a desktop tab and an overflow menu. `teams` survives as an id without a tab: the route is
 * still real, it is reached from Settings, and it lights no cell for the same reason
 * `/settings` lights none.
 */
export type PrimaryNavId =
  | "dashboard"
  | "add-run"
  | "analysis"
  | "paddock"
  | "engineer"
  | "teams"
  | "tools"
  | "settings";

export type PrimaryNavItem = {
  id: PrimaryNavId;
  href: string;
  label: string;
  /** JRC "Solid Form" glyph — solid in both states; active is a colour swap. */
  icon: JrcIcon;
  /** Resolve href from today's draft run when available. */
  smartDraft?: boolean;
  /** Next.js Link prefetch — false for heavy routes. */
  prefetch?: boolean;
};

/** Routes that render without sidebar or bottom nav chrome. */
export function isHiddenNavRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  // Both legal pages are public. /terms was missing here until the 2026-09-05 pre-release walk:
  // a signed-out reader got the full dock and rail, and every tap on it bounced to /login.
  if (pathname === "/privacy" || pathname === "/terms") return true;
  // The paid door's public surfaces — a stranger has no session, so every nav tap would just
  // bounce to /login (MONETISATION_NORTH_STAR.md Phases 1+4).
  if (pathname === "/welcome") return true;
  if (pathname === "/join" || pathname.startsWith("/join/")) return true;
  // Demo entry page (the demo SESSION itself gets full nav — only this splash hides it).
  if (pathname === "/demo") return true;
  if (pathname.startsWith("/api/")) return true;
  return false;
}

/**
 * Routes where the floating "Log run" FAB is suppressed because the user is
 * already inside a create/edit flow with its own bottom-anchored primary action
 * (so a second floating CTA would collide or confuse). Deliberately narrow —
 * the FAB stays available on lists, hubs, dashboard, analysis, and engineer.
 * Extend this list as new form surfaces with sticky Save bars appear.
 */
const LOG_RUN_FAB_HIDDEN_PATTERNS: readonly RegExp[] = [
  /^\/runs\/new(?:\/|$)/, // logging a run — you're already here
  /^\/runs\/[^/]+\/edit(?:\/|$)/, // editing a run
  /^\/setup-documents\/[^/]+(?:\/|$)/, // setup document editor (own Save)
];

export function shouldShowLogRunFab(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return !LOG_RUN_FAB_HIDDEN_PATTERNS.some((re) => re.test(pathname));
}

const ANALYSIS_PREFIXES = [
  "/runs/history",
  // Run view (`/runs/<id>`) lights Analysis. Longest-prefix scoring keeps `/runs/new` and
  // `/runs/<id>/edit` on the Add-run tab (addRunMatchScore returns the full path length).
  "/runs",
  "/analysis",
] as const;

/**
 * Tools own the workbenches you go to deliberately. `/analysis/roll-center` sits under
 * `/analysis` but scores longer here, and longest-prefix wins — so the lab lights Tools
 * without needing to move route.
 *
 * `/videos` and `/laps` joined the list when Tools became a page rather than a menu
 * (2026-08-19), and both were homeless before it. The line between the two sections is where
 * the WORK happens, not what the work is about: a video's results read on the run, which is
 * Analysis, but the workshop you upload and sync in is a bench. `/videos/analysis` left
 * `ANALYSIS_PREFIXES` for the same reason — it out-scored `/videos` and split one section
 * across two cells, so opening a job darkened the cell you had just tapped.
 *
 * `/laps/import` had no section at all. Its only door in the whole app was a link inside one
 * dashboard card.
 */
const TOOLS_PREFIXES = [
  "/setup/comparison",
  "/analysis/roll-center",
  "/videos",
  "/laps",
  "/tools",
] as const;

/**
 * Everything a run points at: the car, its setups, the track, the meeting.
 *
 * `/events` and `/tracks` joined this list in the 2026-08-18 restructure — Events had its own
 * tab and Tracks was a row in Settings, filed there because that is where the shared catalogs
 * were swept rather than because a track is a preference. Both are reached through Paddock
 * now, so both light it.
 *
 * `/setup/comparison` is in `TOOLS_PREFIXES` and scores longer than `/setup`, so the bench
 * still lights Tools. Longest prefix wins.
 */
const PADDOCK_PREFIXES = [
  "/paddock",
  "/events",
  "/setup-sheet-models",
  "/setup-documents",
  "/setup-calibrations",
  "/setup/",
  "/setup",
  "/tracks",
  "/tires",
  "/cars",
  "/assets",
  "/garage",
] as const;

function matchPrefixScore(pathname: string, prefix: string): number {
  if (prefix === "/") return pathname === "/" ? 1 : 0;
  if (pathname === prefix) return prefix.length;
  if (pathname.startsWith(`${prefix}/`)) return prefix.length;
  return 0;
}

function addRunMatchScore(pathname: string): number {
  if (pathname === "/runs/new") return "/runs/new".length;
  if (/^\/runs\/[^/]+\/edit(?:\/|$)/.test(pathname)) return pathname.length;
  return 0;
}

function sectionMatchScore(pathname: string, prefixes: readonly string[]): number {
  let best = 0;
  for (const prefix of prefixes) {
    best = Math.max(best, matchPrefixScore(pathname, prefix));
  }
  return best;
}

/** Longest-prefix active tab for primary navigation. */
export function resolveActiveNavId(pathname: string): PrimaryNavId | null {
  const scores: Array<{ id: PrimaryNavId; score: number }> = [
    { id: "dashboard", score: pathname === "/" ? 1 : 0 },
    { id: "add-run", score: addRunMatchScore(pathname) },
    { id: "analysis", score: sectionMatchScore(pathname, ANALYSIS_PREFIXES) },
    { id: "tools", score: sectionMatchScore(pathname, TOOLS_PREFIXES) },
    { id: "paddock", score: sectionMatchScore(pathname, PADDOCK_PREFIXES) },
    { id: "engineer", score: matchPrefixScore(pathname, "/engineer") },
    { id: "teams", score: matchPrefixScore(pathname, "/teams") },
    { id: "settings", score: matchPrefixScore(pathname, "/settings") },
  ];

  let best: { id: PrimaryNavId; score: number } | null = null;
  for (const entry of scores) {
    if (entry.score > 0 && (!best || entry.score > best.score)) {
      best = entry;
    }
  }
  return best?.id ?? null;
}

/**
 * Which of the five DOCK cells is active — which, since 2026-08-19, is the same question as
 * which section you are in.
 *
 * **There is no fold left.** Every section the dock can reach owns a cell on both platforms.
 * The last exception was Tools: it had a desktop tab and no phone cell, so the Geometry Lab
 * and the compare bench lit `Analysis` — the cell whose page happened to carry their doors.
 * That was a lie the code told to stop the bar going dark on you, and giving Tools the cell
 * the Paddock restructure freed removes the reason for it.
 *
 * The pair is kept rather than collapsed into `resolveActiveNavId`. Two call sites still ask
 * the mobile question by name, and the next section that outgrows five cells will want a fold
 * again — deleting the seam would mean rediscovering where it went.
 */
export function resolveActiveMobileNavId(pathname: string): PrimaryNavId | null {
  return foldMobileNavId(resolveActiveNavId(pathname));
}

/**
 * The same fold applied to an id you already have — currently the identity.
 *
 * `PrimaryNavProvider` needs this rather than the path-based version above: the dock's active
 * cell is `pendingNavId ?? pathnameId`, and the optimistic half is an id with no path to
 * resolve. Folding only the resolved half would make a tap flicker through "no cell active"
 * before landing.
 *
 * Ids with no cell (`settings`, `teams`, `add-run`) are returned untouched and NOT mapped onto
 * a cell. They are reached from the avatar, from Settings and from the log-run circle — none
 * of which is a dock cell — so lighting one would point at the wrong control.
 */
export function foldMobileNavId(id: PrimaryNavId | null): PrimaryNavId | null {
  return id;
}

const DASHBOARD: PrimaryNavItem = { id: "dashboard", href: "/", label: "Dashboard", icon: IconDashboard };
const ADD_RUN: PrimaryNavItem = {
  id: "add-run",
  href: "/runs/new",
  label: "Add run",
  icon: IconAddRun,
  smartDraft: true,
  prefetch: false,
};
const ANALYSIS: PrimaryNavItem = { id: "analysis", href: "/analysis", label: "Analysis", icon: IconAnalysis };
/**
 * Desktop Analysis lands on the Sessions workbench, not the card hub.
 *
 * At lg+ `/runs/history` IS the analysis surface — session rail on the left, the
 * day's trend or one run in the pane — so the hub's Recent-runs card and trend
 * chart are the same data one click further away. The phone keeps `/analysis`,
 * where the stacked cards are still the right read on a small screen.
 *
 * Same nav id either way, and `/runs/history` was already in `ANALYSIS_PREFIXES`,
 * so the tab lights identically and no active-state logic changes. This is a
 * different destination for the same section, not a different section.
 */
const ANALYSIS_DESKTOP: PrimaryNavItem = { ...ANALYSIS, href: "/runs/history" };
/**
 * Tools — the benches: geometry, setup comparison, video, lap import (founder call 2026-08-19).
 *
 * It has been a tab with no page behind it worth landing on. `/tools` listed three doors with a
 * sentence under each, which is the shape `/more` had, so the rail opened a dropdown instead
 * (`ToolsNavMenu`) and the phone got no cell at all — the benches sat as two links at the foot of
 * `/analysis`, with `foldMobileNavId` lighting the Analysis cell while you stood inside the Lab.
 *
 * The Paddock restructure freed a dock cell and it went into padding. This spends it: `/tools` is
 * a real page now, seeded from the driver's own rows, and the fold, the dropdown and the doors on
 * `/analysis` all went with it.
 */
const TOOLS: PrimaryNavItem = { id: "tools", href: "/tools", label: "Tools", icon: IconTools };
/**
 * Paddock — cars, setups, tracks and meetings (founder call 2026-08-18).
 *
 * It replaced three things at once: the `Garage` cell, the `Events` tab, and the `More`
 * drawer that had swallowed both. Those were three names for one idea — everything a run
 * points at — and `More` in particular was a menu word occupying a cell, listing doors that
 * each needed a sentence to explain themselves.
 *
 * Named Paddock rather than Garage because it is no longer only your cars: a track is where
 * you race and a meeting is when, and neither is equipment. `/paddock` is a summary; `/cars`,
 * `/tracks` and `/events` are unchanged behind it and still hold the lists and the editors.
 */
const PADDOCK: PrimaryNavItem = { id: "paddock", href: "/paddock", label: "Paddock", icon: IconGarage };
const ENGINEER: PrimaryNavItem = { id: "engineer", href: "/engineer", label: "Engineer", icon: IconEngineer };
const SETTINGS: PrimaryNavItem = { id: "settings", href: "/settings", label: "Settings", icon: IconSettings };

/**
 * The two items that left the destination lists for the desktop rail's utility
 * cluster (2026-08-12). Exported as items rather than inlined as hrefs in
 * `TopRail` so the cluster is still built from this file — `smartDraft` on Add run
 * in particular is behaviour, not a URL, and it must not fork.
 */
export const NAV_ADD_RUN = ADD_RUN;
export const NAV_SETTINGS = SETTINGS;

/**
 * Desktop top rail: seven destinations on one line, left to right.
 *
 * `ADD_RUN` and `SETTINGS` are NOT here any more (2026-08-12) — they moved to the
 * rail's right-hand utility cluster as the yellow Log-run button and the gear.
 * That is not a demotion: it is the same split the phone has always had, where
 * logging a run is a circle beside the dock and Settings lives behind the avatar.
 * Putting a verb and a preference in the same list as seven places was the thing
 * the rail could not justify once it went horizontal and every item cost width.
 *
 * Analysis points at the workbench here (see `ANALYSIS_DESKTOP`).
 *
 * Five now, not seven (2026-08-18). Teams left for Settings, and Events and Garage
 * became Paddock. Ordered daily-loop first, then the things the loop refers to:
 * Dashboard → Analysis → Engineer → Paddock → Tools.
 *
 * **This list and `MOBILE_NAV` are now the same five ids in the same order** (2026-08-19),
 * which they have never been before. Tools was the last id that existed on one platform and
 * not the other. Keep them in step: a destination on one and not the other is what produced
 * both the `More` drawer and the Analysis-lights-for-Tools fold, and each cost more to
 * explain than the tab it saved.
 */
export const DESKTOP_NAV: PrimaryNavItem[] = [
  DASHBOARD,
  ANALYSIS_DESKTOP,
  ENGINEER,
  PADDOCK,
  TOOLS,
];

/**
 * Mobile bottom dock: five destinations, every one of them a place.
 *
 * The cell count is a budget, and it has now moved three times. Six cells were ~42.7px each —
 * under the 44px tap guideline. Five land at 60px, which is what bought the labels back. Four
 * landed at 75px, and that was the 2026-08-18 restructure spending a freed cell on padding:
 *
 *     (390 − 28 padding − 52 log-run circle − 10 gap) ÷ 5 = 60px
 *
 * 60px is not a gamble — it is the width the dock ran at before `More` was deleted, with the
 * labels on and nothing truncated. Tools takes the cell back (founder call 2026-08-19), which
 * was the point of collapsing Garage, Events and `More` into Paddock in the first place.
 *
 * `Add run` is still the circle beside the cells (`LogRunFab`, see `shouldShowLogRunFab`) and
 * Settings still lives behind the account avatar (`AccountMenu`), so neither takes a cell.
 *
 * The dock now maps onto the loop and the two places it refers to — arrive, review, ask, the
 * cars/tracks/meetings behind all three, and the benches you take them to. No menu words, and
 * no id that exists on desktop but not here: `DESKTOP_NAV` carries the same five in the same
 * order, and the mobile fold is the identity.
 *
 * A SIXTH destination costs ~10px off every cell and puts "Dashboard" back into truncation at
 * 9.5px. Put it inside one of these five instead.
 */
export const MOBILE_NAV: PrimaryNavItem[] = [DASHBOARD, ANALYSIS, ENGINEER, PADDOCK, TOOLS];

export type NavHubIconKey =
  | "car"
  | "disc"
  | "layers"
  | "map-pin"
  | "circle-dot"
  | "flask"
  | "calendar"
  | "history"
  | "video"
  | "git-compare"
  | "wrench";

export type NavHubLink = {
  href: string;
  label: string;
  description: string;
  icon: NavHubIconKey;
};

/*
 * `ANALYSIS_HUB_LINKS` and `TOOLS_HUB_LINKS` are both gone (2026-08-19), and they went for the
 * same reason.
 *
 * Each was a list of doors carrying a `description` — a sentence explaining what was behind the
 * door — and that sentence is the tell: it rendered identically for every driver on every day of
 * the year, which is what makes a page read as scaffolding rather than as a place. `/tools` was
 * built out of `TOOLS_HUB_LINKS` and is now built out of the driver's own rows; `/analysis` kept
 * two of `ANALYSIS_HUB_LINKS` as doors at its foot purely because the phone had nowhere else to
 * reach the benches, and it has somewhere now.
 *
 * `NavHubLink` itself stays — `CATALOG_LINKS` under Settings is still genuinely a list of doors,
 * because reference catalogs are things you visit to tidy up rather than places you live.
 */

export type NavHubSection = {
  eyebrow: string;
  links: NavHubLink[];
};

/**
 * Shared reference data, listed under Settings (founder call 2026-07-29). None of it is "yours" —
 * you meet tires, tracks and additives in the run-form pickers, so these pages exist for browsing
 * and cleanup, not for the daily loop. Events deliberately aren't here — they have their own tab
 * (see `EVENTS`), because a meeting is something you plan and review, not reference data.
 */
export type CatalogLink = NavHubLink & { adminOnly?: boolean };

export const CATALOG_LINKS: CatalogLink[] = [
  {
    href: "/setup-sheet-models",
    label: "Chassis types",
    description: "Shared chassis types and setup sheet models (e.g. Mugen MTC3).",
    icon: "layers",
    // Release audit 2026-08-01: catalog/workbench is founder tooling; drivers pick a chassis
    // inside the car wizard.
    adminOnly: true,
  },
  /*
   * Tracks is NOT in this list any more (2026-08-18). It sat here because this is where the
   * shared catalogs were swept when the Garage hub was deleted — filed by plumbing rather
   * than by meaning. A track is not a preference: it carries layouts, grip tags and timing
   * links, and you pick one every time you log a run or book a meeting. It lives on Paddock
   * now. Tyres and additives stay, because you meet those inside the run form and come here
   * only to tidy them up.
   */
  {
    href: "/tires",
    label: "Tire catalog",
    description: "Shared tire compound catalog (e.g. Sweep D32).",
    icon: "circle-dot",
  },
  {
    href: "/additives",
    label: "Additives",
    description: "Shared tire additive catalog (e.g. Mighty Gripper - Yellow).",
    icon: "flask",
  },
  {
    href: "/setup-calibrations",
    label: "Calibrations",
    description: "Shared PDF-to-setup mapping profiles; auto-applied once verified.",
    icon: "wrench",
    adminOnly: true,
  },
];

export function catalogLinksForUser(isAdmin: boolean): CatalogLink[] {
  return isAdmin ? CATALOG_LINKS : CATALOG_LINKS.filter((link) => !link.adminOnly);
}
