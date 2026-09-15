import { prisma } from "@/lib/prisma";
import { perfSpan } from "@/lib/perfLog";
import type { AnalysisHomeModel } from "@/lib/analysis/analysisHomeModel";
import { loadTeammatesLastOut } from "@/lib/analysis/loadTeammatesLastOut";

/**
 * Server model for `/analysis` — everything on the page that ISN'T the outing.
 *
 * ## What left, on 2026-08-25
 *
 * The trend chart and the recent-runs list both used to be built here, and both are
 * gone from this file. The page is now one thing — your last time at the track — and
 * `loadAnalysisOuting` builds it: the meeting's runs, the chart drawn from those same
 * runs, and the whole records behind them so a row can open in place.
 *
 * That deleted the event-scoped trend with it, and for three weeks the block was one
 * calendar day ("don't unfold the whole event", 2026-08-25). Reversed 2026-09-14: the
 * block is the whole meeting again, now cut into days — the loader carries the story.
 *
 * "Recent runs" went for a plainer reason: three rows from three different weekends,
 * with nothing saying which day any of them belonged to, is a weaker answer than the
 * outing block gives for free.
 *
 * What is left is cheap and cacheable: two counts and the Your-team card. The outing
 * itself is deliberately NOT cached — see the note at its call site.
 *
 * The "Out with you" standing — everyone at your track that day, teammate or not — was loaded
 * here from 2026-08-19 until 2026-09-14, when the founder ruled that nobody outside your team
 * sees anything you logged. Deleted, not dormant; `TeammatesCard` carries the note.
 */
export async function loadAnalysisHomeModel(
  userId: string,
  timeZone: string
): Promise<AnalysisHomeModel> {
  const [totalRunCount, teamCount, teammates] = await Promise.all([
    // The number on the Sessions door. One indexed count on `userId`, inside a
    // read that is already cached for 30s — it runs on a miss, not per render.
    perfSpan("analysisTotalRunCount", () => prisma.run.count({ where: { userId } })),
    // Membership only — the door needs to know IF he is on a team, never which one.
    // Rides this wave, so it costs no extra round trip.
    perfSpan("analysisTeamCount", () => prisma.teamMembership.count({ where: { userId } })),
    // Every teammate, the ones out with you today first. The zone decides what "today" is.
    loadTeammatesLastOut(userId, timeZone),
  ]);

  return {
    totalRunCount,
    hasTeam: teamCount > 0,
    teammates,
  };
}
