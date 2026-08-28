import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { BandHeader } from "@/components/ui/BandHeader";
import type { ToolsLapSession } from "@/lib/tools/toolsModel";

/**
 * The lap-time analysis band — sessions you pulled in that aren't on a run.
 *
 * These rows used to read as filing: an import "waiting" to be attached to a run, because
 * attaching it to a run was the only thing you could do with one. That was the whole bug in
 * how lap analysis was shaped — you could only study a session if you were the driver who
 * logged it, which is not how a team manager, an engineer, or anyone watching a meeting on
 * the other side of the world uses timing data.
 *
 * So the rows now OPEN. Each one is a door into `/laps/analysis`, where the same lap sheet
 * the run pop-up draws reads a session with no run behind it at all.
 *
 * Unattached is half the filter; RECENT is the other half. Measured on a real account, unbounded
 * "not on a run" was 503 rows, because expanding a LiveRC event hub stores every race on it and
 * almost none of them are yours — the band read "500 more waiting", a true number describing no
 * task anyone had. See `UNLINKED_LAP_WINDOW_DAYS`.
 */
export function LapImportBench({
  sessions,
  total,
}: {
  sessions: ToolsLapSession[];
  total: number;
}) {
  const remaining = Math.max(0, total - sessions.length);

  return (
    /* `h-full` + a flex column: on the three-across desktop Tools grid this card is stretched to
       the geometry card's height, and the list grows so the door stays on the foot. */
    <CardPanel className="h-full" contentClassName="flex h-full flex-col p-0">
      {/* "Laptime Analysis", not "Lap times" (founder call, 2026-08-27): the band is named for
          what it opens onto, the same way "Geometry Lab" is, not for the rows it lists. */}
      <BandHeader label="Laptime Analysis" addHref="/laps/analysis" addLabel="Upload a session" />

      {sessions.length === 0 ? (
        <p className="flex-1 px-4 py-3 text-[13px] text-muted-foreground">
          Nothing imported lately. Bring in any LiveRC or Speedhive session — or a MyRCM
          result PDF — and read it here.
        </p>
      ) : (
        <ul className="flex-1">
          {sessions.map((session) => (
            <li key={session.id} className="border-b border-border/60 last:border-b-0">
              <Link
                href={session.href}
                className="tap-active flex items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="ui-title block truncate text-[13px] font-semibold text-foreground">
                    {session.title}
                  </span>
                  <span className="ui-caption mt-0.5 block truncate">{session.detail}</span>
                </span>
                {/* Was "not on a run" — a state, back when filing it onto one was all a row
                    could lead to. The row leads somewhere now, so the chevron says it. */}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/laps/analysis"
        className="tap-active mt-auto flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 transition hover:bg-muted/40"
      >
        <span className="type-timestamp">
          {remaining > 0 ? `${remaining} more · upload one` : "Upload a session"}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </CardPanel>
  );
}
