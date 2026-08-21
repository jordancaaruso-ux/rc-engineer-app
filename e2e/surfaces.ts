/**
 * The page list both whole-app audits walk (`light-mode-audit`, `typography-audit`).
 *
 * Hoisted out of light-mode-audit 2026-08-14. Two copies of this list is how one audit
 * quietly stops covering a route the other still checks.
 */
export type Surface = { slug: string; path: string };

export const STATIC_SURFACES: Surface[] = [
  { slug: "dashboard", path: "/" },
  { slug: "analysis", path: "/analysis" },
  { slug: "roll-center", path: "/analysis/roll-center" },
  { slug: "sessions", path: "/runs/history" },
  { slug: "log-run", path: "/runs/new" },
  { slug: "engineer", path: "/engineer" },
  // A dock cell since the 2026-08-18 restructure, so it belongs in both whole-app audits.
  { slug: "paddock", path: "/paddock" },
  { slug: "events", path: "/events" },
  { slug: "garage", path: "/cars" },
  { slug: "setup-hub", path: "/setup" },
  { slug: "setup-comparison", path: "/setup/comparison" },
  { slug: "setup-documents", path: "/setup-documents" },
  { slug: "setup-calibrations", path: "/setup-calibrations" },
  { slug: "chassis-types", path: "/setup-sheet-models" },
  { slug: "tracks", path: "/tracks" },
  { slug: "tires", path: "/tires" },
  { slug: "additives", path: "/additives" },
  { slug: "videos", path: "/videos" },
  { slug: "video-analysis", path: "/videos/analysis" },
  { slug: "lap-import", path: "/laps/import" },
  { slug: "teams", path: "/teams" },
  { slug: "settings", path: "/settings" },
  { slug: "billing", path: "/billing" },
];

/** Append the record-specific routes the demo sign-in script hands back. */
export function withDetailSurfaces(ids: Record<string, string>): Surface[] {
  const out = [...STATIC_SURFACES];
  if (ids.RUN_ID) out.push({ slug: "run-detail", path: `/runs/${ids.RUN_ID}` });
  if (ids.CAR_ID) out.push({ slug: "car-detail", path: `/cars/${ids.CAR_ID}` });
  if (ids.SETUP_CAR_ID && ids.SETUP_ID) {
    out.push({ slug: "setup-detail", path: `/cars/${ids.SETUP_CAR_ID}/setups/${ids.SETUP_ID}` });
  }
  if (ids.EVENT_ID) out.push({ slug: "event-detail", path: `/events/${ids.EVENT_ID}` });
  if (ids.TRACK_ID) out.push({ slug: "track-detail", path: `/tracks/${ids.TRACK_ID}` });
  return out;
}
