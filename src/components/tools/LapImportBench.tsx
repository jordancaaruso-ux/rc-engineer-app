import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import type { ToolsLapSession } from "@/lib/tools/toolsModel";

/**
 * The lap-import band — timing sessions you pulled in and never attached to a run.
 *
 * This band is the clearest argument for the page existing. `/laps/import` has never had a door
 * in the nav: the only way in is one link inside a dashboard card, so a session imported on
 * Saturday and not attached is invisible by Sunday unless you happen to scroll past that card
 * again. It is a tool with no door, and this is the page for tools with no door.
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
    <CardPanel contentClassName="p-0">
      {sessions.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">
          Nothing waiting. Imported sessions show up here until they&apos;re on a run.
        </p>
      ) : (
        <ul>
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
                {/* "not on a run" and not "link it": the row is a state, and the verb belongs to
                    the page it opens, which is where the run picker actually is. */}
                <span className="type-timestamp shrink-0">not on a run</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/laps/import"
        className="tap-active flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 transition hover:bg-muted/40"
      >
        <span className="type-timestamp">
          {remaining > 0 ? `${remaining} more waiting` : "Import a timing URL"}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </CardPanel>
  );
}
