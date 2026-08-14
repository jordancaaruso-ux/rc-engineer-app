import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

const MAX_HANDLING_LINES = 4;
const MAX_SETUP_CHANGES = 5;

/**
 * The ledger — what you changed going into the last run, and how it felt.
 *
 * Desktop only (`hidden xl:block`), sitting under the hero. Added 2026-08-07, restyled
 * to the design handoff 2026-08-08: the rating / best / avg-top-5 figures it used to
 * carry now live in the hero's numeral and dials, so this card is purely the two-column
 * read. Straight from `recentRun`, which the model has always built — no query.
 *
 * It stops at "here is what you changed and here is how it felt" and leaves the
 * conclusion to the driver — the "what should I change next" card is deferred, not built.
 * Everything here is recorded fact, nothing is inferred.
 */
export function DashboardLastRunReadCard({
  run,
  showSetupChanges = true,
  headline,
}: {
  run: DashboardHomeModel["recentRun"];
  /**
   * False on a track day whose newest run IS this run — the day verdict's "last change"
   * row and the run strip's top row already carry that diff, and a third copy made the
   * same setup change appear three times on one screen.
   */
  showSetupChanges?: boolean;
  /** Overrides the eyebrow, e.g. "Last change" on a track day. */
  headline?: string;
}) {
  if (!run) return null;

  const handlingLines = run.handlingLines.slice(0, MAX_HANDLING_LINES);
  const changes = showSetupChanges ? (run.setupChanges ?? []) : [];
  const shownChanges = changes.slice(0, MAX_SETUP_CHANGES);
  const extraChanges = changes.length - shownChanges.length;

  const hasFeel = handlingLines.length > 0 || Boolean(run.handlingProblems);
  const hasChanges = shownChanges.length > 0;
  // Nothing recorded beyond the lap times: the hero already showed those, and an
  // empty-bodied card reads as a bug.
  if (!hasFeel && !hasChanges) return null;

  // `formatRunSessionDisplay` returns a literal em dash for an unlabelled run
  // (src/lib/runSession.ts), which reads as a broken field. Treat it as absent.
  const label = run.sessionLabel.trim();
  const hasLabel = label.length > 0 && label !== "—";
  const meta = [hasLabel ? label : null, run.carName, run.trackName, run.eventName]
    .filter(Boolean)
    .join(" · ");

  return (
    <SurfaceCard contentClassName="p-0" className="hidden rounded-xl xl:block">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span className="micro-caps text-faint">
          {headline ?? "Last run read"}
        </span>
        {meta ? <span className="truncate text-[11.5px] text-faint">{meta}</span> : null}
      </div>

      <div
        className={cn(
          "grid",
          hasFeel && hasChanges ? "grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]" : "grid-cols-1",
        )}
      >
        {hasChanges ? (
          <section className="px-5 py-4">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-faint">
              You changed
            </h3>
            <ul className="mt-1.5">
              {shownChanges.map((row, i) => (
                <li
                  key={row.key}
                  className={cn(
                    "flex items-baseline justify-between gap-3 py-[9px]",
                    i < shownChanges.length - 1 && "border-b border-border/70",
                  )}
                >
                  <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                    {row.label}
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-foreground">
                    {row.previous != null ? `${row.previous} → ${row.current}` : row.current}
                    {row.unit ? ` ${row.unit}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {extraChanges > 0 ? (
              <p className="mt-2 text-[11.5px] text-faint">+{extraChanges} more</p>
            ) : null}
          </section>
        ) : null}

        {hasFeel && hasChanges ? <div className="bg-border" aria-hidden /> : null}

        {hasFeel ? (
          <section className="px-5 py-4">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-faint">
              How it felt
            </h3>
            <ul className="mt-1.5 space-y-2">
              {handlingLines.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span
                    className="mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full bg-faint"
                    aria-hidden
                  />
                  <span className="text-[12.5px] leading-[1.45] text-muted-foreground">{line}</span>
                </li>
              ))}
            </ul>
            {run.handlingProblems ? (
              <p className="mt-3 text-[12.5px] leading-[1.5] text-muted-foreground">
                “{run.handlingProblems}”
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
