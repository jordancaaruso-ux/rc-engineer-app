import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { BandHeader } from "@/components/ui/BandHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { SessionDeletedUndo } from "@/components/laps/SessionDeletedUndo";
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
 *
 * Rows are named for whose and which run, under a day-and-track heading, with the time on the
 * right (founder pick, 2026-09-23 — three rows reading "Imported session" told him nothing).
 */
export function LapImportBench({
  sessions,
  total,
}: {
  sessions: ToolsLapSession[];
  total: number;
}) {
  const remaining = Math.max(0, total - sessions.length);

  // Newest on track first, so one day's rows already sit together.
  const groups: Array<{ key: string; label: string; items: ToolsLapSession[] }> = [];
  for (const session of sessions) {
    const last = groups[groups.length - 1];
    if (last && last.key === session.groupKey) last.items.push(session);
    else groups.push({ key: session.groupKey, label: session.groupLabel, items: [session] });
  }

  return (
    /* `h-full` + a flex column: on the three-across desktop Tools grid this card is stretched to
       the geometry card's height, and the list grows so the door stays on the foot. */
    <CardPanel className="h-full" contentClassName="flex h-full flex-col p-0">
      {/* "Laptime Analysis", not "Lap times" (founder call, 2026-08-27): the band is named for
          what it opens onto, the same way "Geometry Lab" is, not for the rows it lists. */}
      <BandHeader label="Laptime Analysis" />

      {sessions.length === 0 ? (
        <p className="flex-1 px-4 py-3 text-[13px] text-muted-foreground">
          Nothing imported lately. Bring in any LiveRC or Speedhive session — or a MyRCM
          result PDF — and read it here.
        </p>
      ) : (
        <div className="flex-1">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h3 className="px-4 pb-0.5 pt-2.5 text-[11.5px] font-semibold leading-4 text-foreground/75">
                {group.label}
              </h3>
              <ul>
                {group.items.map((session) => (
                  <li key={session.id} className="border-b border-border/60 last:border-b-0">
                    <Link
                      href={session.href}
                      className="tap-active flex items-center gap-3 px-4 py-2.5 transition hover:bg-muted/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="ui-title block truncate text-[13px] font-semibold text-foreground">
                          {session.title}
                        </span>
                        {session.detail ? (
                          <span className="ui-caption mt-0.5 block truncate">{session.detail}</span>
                        ) : null}
                      </span>
                      {session.time ? (
                        <span className="type-timestamp shrink-0">{session.time}</span>
                      ) : null}
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* The door is a button in the foot, the Geometry Lab's pattern beside it (founder call,
          2026-09-24): a "+" in the header and a grey "upload one" line were too quiet to find.
          Yellow for a day, then the grey door like every "Open …" (founder pick 2026-09-25, off
          a bench of this page) — a grey BUTTON, which is not the grey line that went unfound. */}
      <div className="mt-auto flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
        {remaining > 0 ? <span className="type-timestamp mr-auto">{remaining} more</span> : null}
        <ButtonLink href="/laps/analysis" variant="door">
          Open lap time analysis
        </ButtonLink>
      </div>

      {/* The Undo for a session just deleted on its own page, which sent the driver back here. */}
      <SessionDeletedUndo />
    </CardPanel>
  );
}
