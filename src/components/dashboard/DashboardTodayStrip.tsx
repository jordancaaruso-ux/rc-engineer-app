"use client";

import Link from "next/link";
import { useTodayDraftRun } from "@/components/layout/TodayDraftRunProvider";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { formatAppTimestampUtc } from "@/lib/formatDate";

/**
 * Draft-resume card — appears only when today has an unfinished run. Buttonless
 * and fully tappable (the whole card links to the draft); the mobile Log-run FAB
 * is the sole log action now, so there's no inline log button here (2026-07-06,
 * per founder — the dashboard hero button was retired).
 *
 * `todayRunCount` is accepted-but-unused on purpose: the summary card owns run
 * totals; this strip is purely the "finish your draft" nudge, and keeping the
 * prop avoids churning the caller chain.
 */
export function DashboardTodayStrip({
  serverDraftRunId,
  serverDraftSavedAt,
}: {
  todayRunCount: number;
  serverDraftRunId: string | null;
  serverDraftSavedAt: string | null;
}) {
  const { draftRunId, draftSavedAt } = useTodayDraftRun();
  const todayDraftRunId = draftRunId ?? serverDraftRunId;
  const todayDraftSavedAt = draftSavedAt ?? serverDraftSavedAt;

  // No unfinished run → render nothing; the floating Log-run pill is the CTA.
  if (!todayDraftRunId) return null;

  return (
    <Link
      href={`/runs/${encodeURIComponent(todayDraftRunId)}/edit`}
      prefetch
      aria-label="Complete your logged run"
      className="group mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-border bg-background/45 px-3.5 py-2.5 transition-colors hover:bg-background/70"
    >
      <div className="min-w-0">
        <div className="type-data-label">Unfinished run</div>
        <p className="mt-0.5 truncate text-[13px] text-foreground">
          Finish the run you saved earlier
        </p>
        {todayDraftSavedAt ? (
          <div className="mt-0.5 type-timestamp">
            Draft saved{" "}
            <RelativeTime
              iso={todayDraftSavedAt}
              fallback={formatAppTimestampUtc(todayDraftSavedAt)}
            />
          </div>
        ) : null}
      </div>
      <span
        aria-hidden
        className="shrink-0 text-lg leading-none text-primary transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
    </Link>
  );
}
