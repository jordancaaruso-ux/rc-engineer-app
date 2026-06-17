import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Calendar,
  Car,
  CircleDot,
  GitCompare,
  History,
  Layers,
  LayoutDashboard,
  MapPin,
  PlusCircle,
  Settings,
  Sparkles,
  Video,
  Wrench,
} from "lucide-react";

export type PrimaryNavId =
  | "dashboard"
  | "add-run"
  | "analysis"
  | "garage"
  | "engineer"
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

const ANALYSIS_PREFIXES = [
  "/setup/comparison",
  "/videos/analysis",
  "/runs/history",
  "/analysis",
] as const;

const GARAGE_PREFIXES = [
  "/setup-sheet-models",
  "/setup-documents",
  "/setup-calibrations",
  "/setup/",
  "/setup",
  "/events",
  "/tracks",
  "/tires",
  "/cars",
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
    { id: "garage", score: sectionMatchScore(pathname, GARAGE_PREFIXES) },
    { id: "engineer", score: matchPrefixScore(pathname, "/engineer") },
    { id: "settings", score: Math.max(matchPrefixScore(pathname, "/settings"), matchPrefixScore(pathname, "/teams")) },
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
const GARAGE: PrimaryNavItem = { id: "garage", href: "/garage", label: "Garage", icon: Car };
const ENGINEER: PrimaryNavItem = { id: "engineer", href: "/engineer", label: "Engineer", icon: Sparkles };
const SETTINGS: PrimaryNavItem = { id: "settings", href: "/settings", label: "Settings", icon: Settings };

export const PRIMARY_NAV: PrimaryNavItem[] = [DASHBOARD, ADD_RUN, ANALYSIS, GARAGE, ENGINEER, SETTINGS];

/** Desktop sidebar: same six sections, natural top-to-bottom order. */
export const DESKTOP_NAV: PrimaryNavItem[] = [DASHBOARD, ADD_RUN, ANALYSIS, GARAGE, ENGINEER, SETTINGS];

/** Mobile bottom bar: Add run centered between Analysis and Garage. */
export const MOBILE_NAV: PrimaryNavItem[] = [DASHBOARD, ANALYSIS, ADD_RUN, GARAGE, ENGINEER, SETTINGS];

export type NavHubLink = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const ANALYSIS_HUB_LINKS: NavHubLink[] = [
  {
    href: "/runs/history",
    label: "Sessions",
    description: "Browse and compare logged runs.",
    icon: History,
  },
  {
    href: "/videos/analysis/manual/new",
    label: "Lap sync",
    description: "Review onboard footage and lap timing.",
    icon: Video,
  },
  {
    href: "/setup/comparison",
    label: "Setup comparison",
    description: "Compare setups across runs and community data.",
    icon: GitCompare,
  },
];

export const GARAGE_HUB_LINKS: NavHubLink[] = [
  {
    href: "/cars",
    label: "Cars",
    description: "Your cars — name each one and link it to a chassis type.",
    icon: Car,
  },
  {
    href: "/setup-sheet-models",
    label: "Chassis types",
    description: "Shared setup sheet models per chassis (e.g. Mugen MTC3).",
    icon: Layers,
  },
  {
    href: "/tracks",
    label: "Tracks",
    description: "Tracks, layouts, and grip tags.",
    icon: MapPin,
  },
  {
    href: "/tires",
    label: "Tires",
    description: "Tire compounds and your tire sets.",
    icon: CircleDot,
  },
  {
    href: "/events",
    label: "Events",
    description: "Race weekends and practice days.",
    icon: Calendar,
  },
  {
    href: "/setup",
    label: "Setup",
    description: "Setup documents, calibrations, and bulk import.",
    icon: Wrench,
  },
];
