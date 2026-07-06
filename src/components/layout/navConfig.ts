import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Car,
  LayoutDashboard,
  PlusCircle,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

export type PrimaryNavId =
  | "dashboard"
  | "add-run"
  | "analysis"
  | "assets"
  | "engineer"
  | "teams"
  | "settings";

export type PrimaryNavItem = {
  id: PrimaryNavId;
  href: string;
  label: string;
  icon: LucideIcon;
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
  "/analysis",
] as const;

const ASSETS_PREFIXES = [
  "/setup-sheet-models",
  "/setup-documents",
  "/setup-calibrations",
  "/setup/",
  "/setup",
  "/events",
  "/tracks",
  "/tire-sets",
  "/tires",
  "/batteries",
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

const DASHBOARD: PrimaryNavItem = { id: "dashboard", href: "/", label: "Dashboard", icon: LayoutDashboard };
const ADD_RUN: PrimaryNavItem = {
  id: "add-run",
  href: "/runs/new",
  label: "Add run",
  icon: PlusCircle,
  smartDraft: true,
  prefetch: false,
};
const ANALYSIS: PrimaryNavItem = { id: "analysis", href: "/analysis", label: "Analysis", icon: BarChart3 };
const ASSETS: PrimaryNavItem = { id: "assets", href: "/assets", label: "Assets", icon: Car };
const ENGINEER: PrimaryNavItem = { id: "engineer", href: "/engineer", label: "Engineer", icon: Sparkles };
const TEAMS: PrimaryNavItem = { id: "teams", href: "/teams", label: "Teams", icon: Users };
const SETTINGS: PrimaryNavItem = { id: "settings", href: "/settings", label: "Settings", icon: Settings };

export const PRIMARY_NAV: PrimaryNavItem[] = [DASHBOARD, ADD_RUN, ANALYSIS, ASSETS, ENGINEER, TEAMS, SETTINGS];

/** Desktop sidebar: full section list, natural top-to-bottom order. */
export const DESKTOP_NAV: PrimaryNavItem[] = [DASHBOARD, ADD_RUN, ANALYSIS, ASSETS, ENGINEER, TEAMS, SETTINGS];

/**
 * Mobile bottom dock: five pure destinations. `Add run` is now a floating pill
 * FAB (`LogRunFab`) and `Settings` lives behind the account avatar
 * (`AccountMenu`), so neither sits in the dock. See `shouldShowLogRunFab`.
 */
export const MOBILE_NAV: PrimaryNavItem[] = [DASHBOARD, ANALYSIS, ASSETS, ENGINEER, TEAMS];

export type NavHubIconKey =
  | "car"
  | "disc"
  | "battery"
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
    href: "/videos/analysis/manual/new",
    label: "Video analysis",
    description: "Review onboard footage and lap timing.",
    icon: "video",
  },
  {
    href: "/setup/comparison",
    label: "Setup comparison",
    description: "Compare setups across runs and community data.",
    icon: "git-compare",
  },
];

export type NavHubSection = {
  eyebrow: string;
  links: NavHubLink[];
};

export const ASSETS_HUB_SECTIONS: NavHubSection[] = [
  {
    eyebrow: "My assets",
    links: [
      {
        href: "/cars",
        label: "Cars",
        description: "Your cars — name each one and link it to a chassis type.",
        icon: "car",
      },
      {
        href: "/tire-sets",
        label: "Tires",
        description: "Your tire sets and run wear history.",
        icon: "disc",
      },
      {
        href: "/batteries",
        label: "Batteries",
        description: "Your battery packs and run history.",
        icon: "battery",
      },
      {
        href: "/setup",
        label: "Setup",
        description: "Setup documents, calibrations, and bulk import.",
        icon: "wrench",
      },
    ],
  },
  {
    eyebrow: "Global assets",
    links: [
      {
        href: "/setup-sheet-models",
        label: "Cars",
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
        label: "Tires",
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
        href: "/events",
        label: "Events",
        description: "Race weekends and practice days.",
        icon: "calendar",
      },
    ],
  },
];
