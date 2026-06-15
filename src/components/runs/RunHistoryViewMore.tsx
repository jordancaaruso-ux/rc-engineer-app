import Link from "next/link";

export function buildRunHistoryHref(opts: {
  viewAll?: boolean;
  teamId?: string | null;
  focusRun?: string | null;
}): string {
  const p = new URLSearchParams();
  if (opts.teamId?.trim()) p.set("teamId", opts.teamId.trim());
  if (opts.focusRun?.trim()) p.set("focusRun", opts.focusRun.trim());
  if (opts.viewAll) p.set("viewAll", "1");
  const q = p.toString();
  return q ? `/runs/history?${q}` : "/runs/history";
}

export function RunHistoryViewMore({
  viewAll,
  hasMoreRuns,
  totalRunCount,
  loadedRunCount,
  teamId,
  focusRun,
}: {
  viewAll: boolean;
  hasMoreRuns: boolean;
  totalRunCount: number;
  loadedRunCount: number;
  teamId?: string | null;
  focusRun?: string | null;
}) {
  if (viewAll) {
    return (
      <div className="flex items-center justify-center pt-2">
        <Link
          href={buildRunHistoryHref({ teamId, focusRun })}
          className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition"
        >
          Show recent only
        </Link>
      </div>
    );
  }

  if (!hasMoreRuns) return null;

  const olderRuns = totalRunCount - loadedRunCount;
  return (
    <div className="flex items-center justify-center pt-2">
      <Link
        href={buildRunHistoryHref({ viewAll: true, teamId, focusRun })}
        className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition"
      >
        View more · {olderRuns} older run{olderRuns === 1 ? "" : "s"}
      </Link>
    </div>
  );
}
