import { prisma } from "@/lib/prisma";
import { perfSpan } from "@/lib/perfLog";
import type { AnalysisHomeModel } from "@/lib/analysis/analysisHomeModel";
import { loadOutWithYou } from "@/lib/analysis/loadOutWithYou";
import { loadTeammatesLastOut } from "@/lib/analysis/loadTeammatesLastOut";

/**
 * Server model for `/analysis` — everything on the page that ISN'T the outing.
 *
 * ## What left, on 2026-08-25
 *
 * The trend chart and the recent-runs list both used to be built here, and both are
 * gone from this file. The page is now one thing — your last time at the track — and
 * `loadAnalysisOuting` builds it: one day's runs, the chart drawn from those same
 * runs, and the whole records behind them so a row can open in place.
 *
 * That deleted the event-scoped trend with it. The old chart widened to a whole
 * *meeting* when the latest run had an event, so a three-day title unfolded Friday
 * through Sunday into one picture and one list. Founder call: don't unfold the whole
 * event. The event still names the day; it no longer widens it.
 *
 * "Recent runs" went for a plainer reason: three rows from three different weekends,
 * with nothing saying which day any of them belonged to, is a weaker answer than the
 * outing block gives for free.
 *
 * What is left is cheap and cacheable: two counts and the Teammates card. The outing
 * itself is deliberately NOT cached — see the note at its call site.
 */
export async function loadAnalysisHomeModel(
  userId: string,
  timeZone: string
): Promise<AnalysisHomeModel> {
  const [totalRunCount, teamCount, meeting, lastOut] = await Promise.all([
    // The number on the Sessions door. One indexed count on `userId`, inside a
    // read that is already cached for 30s — it runs on a miss, not per render.
    perfSpan("analysisTotalRunCount", () => prisma.run.count({ where: { userId } })),
    // Membership only — the door needs to know IF he is on a team, never which one.
    // Rides this wave, so it costs no extra round trip.
    perfSpan("analysisTeamCount", () => prisma.teamMembership.count({ where: { userId } })),
    // The two halves of the Teammates card, loaded side by side because they share nothing: one
    // is scoped by who was at the track, the other by who is on your team.
    loadOutWithYou(userId, timeZone),
    loadTeammatesLastOut(userId),
  ]);

  return {
    totalRunCount,
    hasTeam: teamCount > 0,
    // Dropped only when BOTH halves are empty. A driver with a team but no shared meeting still
    // gets the band, and a driver with a meeting but no team still gets the comparison.
    teammates: meeting || lastOut.length > 0 ? { meeting, lastOut } : null,
  };
}
