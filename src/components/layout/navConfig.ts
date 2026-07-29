import {
  IconAddRun,
  IconAnalysis,
  IconDashboard,
  IconEngineer,
  IconEvents,
  IconGarage,
  IconSettings,
  IconTeams,
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
  "/setup/comparison",
  "/videos/analysis",
  "/runs/history",
  // Run view (`/runs/<id>`) lights Analysis. Longest-prefix scoring keeps `/runs/new` and
  // `/runs/<id>/edit` on the Add-run tab (addRunMatchScore returns the full path length).
  "/runs",
  "/analysis",
] as const;

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
    { id: "events", score: matchPrefixScore(pathname, "/events") },
    { id: "assets", score: sectionMatchScore(pathname, ASSETS_PREFIXES) },
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

export const PRIMARY_NAV: PrimaryNavItem[] = [
  DASHBOARD,
  ADD_RUN,
  ANALYSIS,
  EVENTS,
  ENGINEER,
  ASSETS,
  TEAMS,
  SETTINGS,
];

/** Desktop sidebar: full section list, natural top-to-bottom order. */
export const DESKTOP_NAV: PrimaryNavItem[] = [
  DASHBOARD,
  ADD_RUN,
  ANALYSIS,
  EVENTS,
  ENGINEER,
  ASSETS,
  TEAMS,
  SETTINGS,
];

/**
 * Mobile bottom dock: six pure destinations. `Add run` is a circular FAB
 * (`LogRunFab`) rendered beside the bar and `Settings` lives behind the account
 * avatar (`AccountMenu`), so neither sits in the dock. See `shouldShowLogRunFab`.
 *
 * Six is a deliberate squeeze (2026-07-29): with the Ideas cap and the Log-run
 * circle both kept, cells land at ~42.7px at 390px — 1.3px under the 44px tap
 * guideline, tolerable only because the row is 56px tall. If it reads too tight
 * on device, the levers in order of cost are: drop the Ideas cap (→51.3px), move
 * the FAB above the bar (→53.7px, but `--mobile-tab-bar-height` goes 84→150px).
 */
export const MOBILE_NAV: PrimaryNavItem[] = [DASHBOARD, ANALYSIS, EVENTS, ENGINEER, ASSETS, TEAMS];

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
    description: "Compare setups across runs and community data.",
    icon: "git-compare",
  },
  {
    href: "/analysis/roll-center",
    label: "Roll Center Lab",
    description: "What-if suspension geometry — shims, roll, RC migration.",
    icon: "flask",
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
