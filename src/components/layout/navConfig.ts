import {
  IconAddRun,
  IconAnalysis,
  IconDashboard,
  IconEngineer,
  IconEvents,
  IconGarage,
  IconMore,
  IconSettings,
  IconTeams,
  IconTools,
  type JrcIcon,
} from "@/components/icons/JRCIcons";

export type PrimaryNavId =
  | "dashboard"
  | "add-run"
  | "analysis"
  | "events"
  | "assets"
  | "engineer"
  | "teams"
  | "tools"
  | "more"
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
  if (pathname === "/privacy") return true;
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
  /^\/setup-sheet-models\/[^/]+\/schema(?:\/|$)/, // schema editor (own Save)
  /^\/setup-documents\/[^/]+(?:\/|$)/, // setup document editor (own Save)
];

export function shouldShowLogRunFab(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return !LOG_RUN_FAB_HIDDEN_PATTERNS.some((re) => re.test(pathname));
}

const ANALYSIS_PREFIXES = [
  "/videos/analysis",
  "/runs/history",
  // Run view (`/runs/<id>`) lights Analysis. Longest-prefix scoring keeps `/runs/new` and
  // `/runs/<id>/edit` on the Add-run tab (addRunMatchScore returns the full path length).
  "/runs",
  "/analysis",
] as const;

/**
 * Tools own the workbenches you go to deliberately. `/analysis/roll-center` sits
 * under `/analysis` but scores longer here, and longest-prefix wins — so the lab
 * lights Tools without needing to move route.
 */
const TOOLS_PREFIXES = ["/setup/comparison", "/analysis/roll-center", "/tools"] as const;

const ASSETS_PREFIXES = [
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
    { id: "events", score: matchPrefixScore(pathname, "/events") },
    { id: "assets", score: sectionMatchScore(pathname, ASSETS_PREFIXES) },
    { id: "engineer", score: matchPrefixScore(pathname, "/engineer") },
    { id: "teams", score: matchPrefixScore(pathname, "/teams") },
    { id: "more", score: matchPrefixScore(pathname, "/more") },
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
 * The sections the phone reaches through `More` rather than through a cell of
 * its own. They keep their real nav id everywhere else — this is only about
 * which of the five dock cells lights up.
 */
const BEHIND_MORE: readonly PrimaryNavId[] = ["events", "assets", "tools"];

/**
 * Which of the five DOCK cells is active — not which section you are in.
 *
 * `resolveActiveNavId` answers the second question and is shared with desktop,
 * where Events, Garage and Tools each own a tab. On the phone they sit behind
 * `More`, and without this fold a driver on `/events` would watch every cell go
 * dark and the indicator fade out: technically "no cell matches", but it reads as
 * having navigated out of the app rather than one level into it.
 *
 * Returns the section id untouched for everything the dock shows directly, so the
 * two functions agree on all five cells and differ only on the overflow.
 */
export function resolveActiveMobileNavId(pathname: string): PrimaryNavId | null {
  return foldMobileNavId(resolveActiveNavId(pathname));
}

/**
 * The same fold applied to an id you already have.
 *
 * `PrimaryNavProvider` needs this rather than the path-based version above: the
 * dock's active cell is `pendingNavId ?? pathnameId`, and the optimistic half is
 * an id with no path to resolve. Folding only the resolved half would make a tap
 * on More flicker through "no cell active" before landing.
 */
export function foldMobileNavId(id: PrimaryNavId | null): PrimaryNavId | null {
  if (id && BEHIND_MORE.includes(id)) return "more";
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
/** Desktop-only: on the phone these stay as doors on `/analysis`. */
const TOOLS: PrimaryNavItem = { id: "tools", href: "/tools", label: "Tools", icon: IconTools };
/**
 * Events got their own tab (founder call 2026-07-29). They had one door left after the Garage hub
 * was deleted — the dashboard Next-outing card — and a meeting is neither an asset nor team data,
 * so no existing tab fitted. Sits next to Analysis; `/events` no longer lights Garage.
 */
const EVENTS: PrimaryNavItem = { id: "events", href: "/events", label: "Events", icon: IconEvents };
/**
 * Garage is the cars & setups list itself — there is no hub in between (founder call 2026-07-29).
 * The old `/assets` hub duplicated `/cars` and listed a "My tires" row that pointed at the shared
 * catalog; the catalogs now live under Settings and `/assets` + `/garage` redirect here.
 */
const ASSETS: PrimaryNavItem = { id: "assets", href: "/cars", label: "Garage", icon: IconGarage };
const ENGINEER: PrimaryNavItem = { id: "engineer", href: "/engineer", label: "Engineer", icon: IconEngineer };
const TEAMS: PrimaryNavItem = { id: "teams", href: "/teams", label: "Teams", icon: IconTeams };
const SETTINGS: PrimaryNavItem = { id: "settings", href: "/settings", label: "Settings", icon: IconSettings };
/**
 * The phone's overflow door (nav restructure 2026-08-12). Not a section — a page
 * listing the three sections the dock has no room for. Desktop never shows it:
 * the top rail carries all seven destinations on one line.
 */
const MORE: PrimaryNavItem = { id: "more", href: "/more", label: "More", icon: IconMore };

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
 * Analysis points at the workbench here (see `ANALYSIS_DESKTOP`). Tools is on this
 * list and not in the dock; the phone reaches it through `More`.
 *
 * Ordered daily-loop first, then the places you visit around it (founder call
 * 2026-08-13): Dashboard → Analysis → Engineer → Teams are the four the dock also
 * carries, in the dock's own order, so the two platforms read the same left to
 * right; Events, Garage and Tools follow in the order `/more` lists them. Tools
 * sits last because it is the only tab that opens a menu rather than going
 * somewhere (`ToolsNavMenu`) — its panel hangs off the end of the row, clear of
 * the tabs beside it.
 */
export const DESKTOP_NAV: PrimaryNavItem[] = [
  DASHBOARD,
  ANALYSIS_DESKTOP,
  ENGINEER,
  TEAMS,
  EVENTS,
  ASSETS,
  TOOLS,
];

/**
 * Mobile bottom dock: five destinations, the last of which is a door to the rest.
 *
 * Was six pure destinations squeezed to ~42.7px each — under the 44px tap
 * guideline, and that was BEFORE the row had to hold anything else. Five cells in
 * the full-bleed slab land at 60px at 390px:
 *
 *     (390 − 28 padding − 52 log-run circle − 10 gap) ÷ 5 = 60px
 *
 * which is what buys the labels back. `Add run` is still the circle beside the
 * cells (`LogRunFab`, see `shouldShowLogRunFab`) and Settings still lives behind
 * the account avatar (`AccountMenu`), so neither takes a cell. Events, Garage and
 * Tools moved behind `More` — see `resolveActiveMobileNavId`, which keeps the More
 * cell lit while you are inside any of them.
 *
 * Adding a sixth destination here costs ~10px off every cell and puts "Dashboard"
 * back into truncation at 9.5px. Add it to `/more` instead.
 */
export const MOBILE_NAV: PrimaryNavItem[] = [DASHBOARD, ANALYSIS, ENGINEER, TEAMS, MORE];

/**
 * What `/more` lists. The three sections the dock gave up, in the order the rail
 * shows them, each landing exactly where its desktop tab lands.
 */
export const MORE_HUB_LINKS: NavHubLink[] = [
  {
    href: "/events",
    label: "Events",
    description: "Race meetings and club days — planned and reviewed.",
    icon: "calendar",
  },
  {
    href: "/cars",
    label: "Garage",
    description: "Your cars and their setups.",
    icon: "car",
  },
  {
    href: "/tools",
    label: "Tools",
    description: "Compare setups, model geometry, and review video.",
    icon: "wrench",
  },
];

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

export const ANALYSIS_HUB_LINKS: NavHubLink[] = [
  {
    href: "/runs/history",
    label: "Sessions",
    description: "Browse and compare logged runs.",
    icon: "history",
  },
  {
    href: "/videos",
    label: "Video",
    description: "Analysis sessions, saved videos, and tools.",
    icon: "video",
  },
  {
    href: "/setup/comparison",
    label: "Setup comparison",
    description: "Put two setups on one sheet and swap between them.",
    icon: "git-compare",
  },
  {
    href: "/analysis/roll-center",
    label: "Geometry Lab",
    description: "What-if suspension geometry — shims, roll, RC migration.",
    icon: "flask",
  },
];

/**
 * Tools hub (`/tools`) — the workbenches you open on purpose, rather than glance
 * at. Same links the phone still shows as doors on `/analysis`; this is where
 * desktop reaches them now that Analysis lands on the Sessions workbench.
 */
export const TOOLS_HUB_LINKS: NavHubLink[] = [
  {
    href: "/setup/comparison",
    label: "Setup comparison",
    description: "Put two setups on one sheet and swap between them.",
    icon: "git-compare",
  },
  {
    href: "/analysis/roll-center",
    label: "Geometry Lab",
    description: "What-if suspension geometry — shims, roll, RC migration.",
    icon: "flask",
  },
  {
    href: "/videos",
    label: "Video",
    description: "Analysis sessions, saved videos, and tools.",
    icon: "video",
  },
];

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
  {
    href: "/tracks",
    label: "Tracks",
    description: "Tracks, layouts, and grip tags.",
    icon: "map-pin",
  },
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
