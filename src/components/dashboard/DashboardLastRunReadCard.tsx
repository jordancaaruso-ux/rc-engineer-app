import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import { Eyebrow, StatStrip, StatTile } from "@/components/ui/panel";
import { CardPanel } from "@/components/ui/CardPanel";

const MAX_HANDLING_LINES = 4;
const MAX_SETUP_CHANGES = 4;

/**
 * The read on the last run — rating, how it felt, and what was changed going in.
 *
 * Desktop only (`hidden xl:block`), rail card in both modes. Added 2026-08-07 with
 * the desktop pass (docs/DASHBOARD_NORTH_STAR.md): `recentRun` has always been
 * computed by the dashboard model and was never rendered, so this costs no query.
 *
 * It deliberately stops at "here is what you changed and here is how it felt" and
 * leaves the conclusion to the driver — the "what should I change next" card is
 * deferred, not built. Everything here is recorded fact, nothing is inferred.
 */
export function DashboardLastRunReadCard({
  run,
  showSetupChanges = true,
}: {
  run: DashboardHomeModel["recentRun"];
  /**
   * False on a track day whose newest run IS this run — the day verdict's "last
   * change" row and the run strip's top row already carry that diff, and a third
   * copy in the rail made the same setup change appear three times on one screen.
   * The rating and handling read are not shown anywhere else, so the card stays.
   */
  showSetupChanges?: boolean;
}) {
  if (!run) return null;

  const handlingLines = run.handlingLines.slice(0, MAX_HANDLING_LINES);
  const changes = showSetupChanges ? (run.setupChanges ?? []) : [];
  const shownChanges = changes.slice(0, MAX_SETUP_CHANGES);
  const extraChanges = changes.length - shownChanges.length;

  // Nothing recorded beyond the lap times: the run page is the better door, and an
  // empty-bodied card in the rail reads as a bug.
  const hasRead =
    run.carRating != null || handlingLines.length > 0 || run.handlingProblems || changes.length > 0;
  if (!hasRead) return null;

  // `formatRunSessionDisplay` returns a literal em dash for an unlabelled run
  // (src/lib/runSession.ts), which reads as a broken field if it leads the card.
  // Treat it as absent and let the car name lead instead.
  const label = run.sessionLabel.trim();
  const hasLabel = label.length > 0 && label !== "—";
  const lead = hasLabel ? label : run.carName;
  const sub = (hasLabel ? [run.carName, run.trackName, run.eventName] : [run.trackName, run.eventName])
    .filter(Boolean)
    .join(" · ");

  const hasFeel = handlingLines.length > 0 || Boolean(run.handlingProblems);
  const hasChanges = shownChanges.length > 0;

  return (
    <CardPanel className="hidden xl:block">
      {/* This card only ever renders in the wide column, so it is laid out FOR
          width — a stat strip across the full measure and a two-up body. Stacking
          it into a narrow ribbon left ~60% of a 752px card empty. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="mb-1.5">Last run</Eyebrow>
          <div className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {lead}
          </div>
          {sub ? (
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{sub}</div>
          ) : null}
        </div>

        <Link
          href={`/runs/${run.id}`}
          prefetch={false}
          className="tap-active shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          Open the run
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {/* Same primitive as the 30-day card directly below it in this column. */}
      <StatStrip className="mt-3" gridClassName="grid-cols-3">
        <StatTile
          label="Rating"
          value={
            run.carRating != null ? (
              <>
                {run.carRating}
                <span className="text-[13px] text-muted-foreground">/10</span>
              </>
            ) : (
              "—"
            )
          }
        />
        <StatTile label="Best lap" value={formatLap(run.bestLap)} />
        <StatTile label="Avg top 5" value={run.avgTop5 != null ? formatLap(run.avgTop5) : "—"} />
      </StatStrip>

      {hasFeel || hasChanges ? (
        <div
          className={cn(
            "mt-3 gap-x-6 gap-y-3 border-t border-border/70 pt-3",
            hasFeel && hasChanges ? "grid grid-cols-2" : ""
          )}
        >
          {hasChanges ? (
            <div className="min-w-0">
              <div className="mb-1 text-[10.5px] uppercase tracking-wide text-faint">
                You changed
              </div>
              <ul className="space-y-0.5">
                {shownChanges.map((row) => (
                  <li key={row.key} className="text-[12px] leading-snug text-muted-foreground">
                    {row.label}{" "}
                    <span className="lap-figure text-foreground">
                      {row.previous != null ? `${row.previous} → ${row.current}` : row.current}
                    </span>
                    {row.unit ? ` ${row.unit}` : ""}
                  </li>
                ))}
                {extraChanges > 0 ? (
                  <li className="text-[11.5px] text-faint">+{extraChanges} more</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {hasFeel ? (
            <div className="min-w-0">
              <div className="mb-1 text-[10.5px] uppercase tracking-wide text-faint">
                How it felt
              </div>
              {handlingLines.length > 0 ? (
                <ul className="space-y-1">
                  {handlingLines.map((line) => (
                    <li key={line} className="text-[12px] leading-snug text-muted-foreground">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
              {run.handlingProblems ? (
                <p className="mt-1.5 line-clamp-3 text-[12px] leading-snug text-muted-foreground">
                  “{run.handlingProblems}”
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </CardPanel>
  );
}
