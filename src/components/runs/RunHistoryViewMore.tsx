import Link from "next/link";

import { OPEN_GROUP_PARAM } from "@/lib/runs/sessionsReturn";

export function buildRunHistoryHref(opts: {
  viewAll?: boolean;
  teamId?: string | null;
  /** Run whose session group stays expanded across this navigation. */
  openGroup?: string | null;
  filterQuery?: string | null;
}): string {
  const p = new URLSearchParams(opts.filterQuery ?? "");
  if (opts.teamId?.trim()) p.set("teamId", opts.teamId.trim());
  else p.delete("teamId");
  if (opts.openGroup?.trim()) p.set(OPEN_GROUP_PARAM, opts.openGroup.trim());
  else p.delete(OPEN_GROUP_PARAM);
  if (opts.viewAll) p.set("viewAll", "1");
  else p.delete("viewAll");
  const q = p.toString();
  return q ? `/runs/history?${q}` : "/runs/history";
}

const FOOT_LINK_CLASS =
  "rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition";

export function RunHistoryViewMore({
  viewAll,
  hasMoreRuns,
  totalRunCount,
  loadedRunCount,
  hiddenByPlanCount = 0,
  teamId,
  openGroup,
  filterQuery,
}: {
  viewAll: boolean;
  hasMoreRuns: boolean;
  totalRunCount: number;
  loadedRunCount: number;
  /** Runs the viewer's own plan is hiding (Starter keeps fifteen — docs/STARTER_TIER_PLAN.md). */
  hiddenByPlanCount?: number;
  teamId?: string | null;
  openGroup?: string | null;
  filterQuery?: string | null;
}) {
  // The Starter upsell, and the whole of it: one row at the foot of the list, in every
  // placement, saying what the plan is holding back. It sits after "Show recent only", and
  // yields to "View more" while there are still visible runs the page has not loaded. Hidden
  // inside the iPhone/Android app, which sells nothing (`web-only`, globals.css).
  const upgradeRow =
    hiddenByPlanCount > 0 ? (
      <div className="web-only flex items-center justify-center pt-2">
        <Link href="/billing" className={FOOT_LINK_CLASS}>
          {hiddenByPlanCount} older run{hiddenByPlanCount === 1 ? "" : "s"} ·{" "}
          <span className="text-primary-ink">Upgrade</span>
        </Link>
      </div>
    ) : null;

  if (viewAll) {
    return (
      <>
        <div className="flex items-center justify-center pt-2">
          <Link href={buildRunHistoryHref({ teamId, openGroup, filterQuery })} className={FOOT_LINK_CLASS}>
            Show recent only
          </Link>
        </div>
        {upgradeRow}
      </>
    );
  }

  if (!hasMoreRuns) return upgradeRow;

  const olderRuns = totalRunCount - loadedRunCount;
  return (
    <div className="flex items-center justify-center pt-2">
      <Link
        href={buildRunHistoryHref({ viewAll: true, teamId, openGroup, filterQuery })}
        className={FOOT_LINK_CLASS}
      >
        View more · {olderRuns} older run{olderRuns === 1 ? "" : "s"}
      </Link>
    </div>
  );
}
