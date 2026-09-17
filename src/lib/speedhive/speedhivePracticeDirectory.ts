import "server-only";

import { timingUserAgent } from "@/lib/http/timingUserAgent";
import { fetchTimingJson } from "@/lib/speedhive/speedhiveClient";
import type { PracticeLocationRow } from "@/lib/speedhive/matchPracticeLocations";

/**
 * Speedhive's RC practice directory (~1,000 locations, ~190KB), fetched when a driver taps
 * "Find on Speedhive" and held in this process's memory for a few minutes only — so a second
 * search from the same card doesn't ask MYLAPS again. It is never written anywhere: copying their
 * directory is what their Conditions of Use 5.3 forbid, and a stored copy would also go stale.
 */
const HOLD_MS = 10 * 60 * 1000;

let held: { at: number; rows: PracticeLocationRow[] } | null = null;

export async function fetchRcPracticeDirectory(now = Date.now()): Promise<PracticeLocationRow[]> {
  if (held && now - held.at < HOLD_MS) return held.rows;
  const data = await fetchTimingJson<{ locations?: PracticeLocationRow[] }>(
    "https://practice-api.speedhive.com/api/v1/locations?sport=RC",
    {
      Accept: "application/json",
      Origin: "https://sporthive.com",
      "User-Agent": timingUserAgent(),
    },
    "Speedhive practice API"
  );
  const rows = (data?.locations ?? []).map((l) => ({
    id: l.id,
    name: l.name ?? null,
    country: l.country ?? null,
    status: l.status ?? null,
  }));
  held = { at: now, rows };
  return rows;
}
