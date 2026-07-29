import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { UploadSetupSheetBar } from "@/components/setup/UploadSetupSheetBar";
import type { DashboardSetups } from "@/lib/setup/dashboardSetups";

/**
 * Setups on the dashboard (founder call 2026-07-29) — docs/DASHBOARD_NORTH_STAR.md.
 *
 * One row per car naming the baseline that car is running, tapping straight into the grid editor.
 * That's a verdict, not a library index: height is bounded by cars, and the full list of baselines
 * stays in Garage. It replaced the self-retiring "add a setup" nag and absorbed its empty state, so
 * there is still exactly one setup surface here — with no Ignore button, per
 * docs/ONBOARDING_NORTH_STAR.md.
 *
 * Unlike every other card on this dashboard it never retires. Editing a setup between runs is a
 * standing job, not a one-off chore, and the Garage was not where anyone looked for it.
 */
export function DashboardSetupsCard({ setups }: { setups: DashboardSetups }) {
  if (!setups.hasAnySetup) {
    const onlyCar = setups.cars.length === 1 ? setups.cars[0]! : null;
    return (
      <CardPanel className="border-primary/25">
        <div className="flex items-center gap-2">
          <Eyebrow>Setup</Eyebrow>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Recommended
          </span>
        </div>

        <p className="mt-2 text-[15px] font-bold leading-snug tracking-[-0.01em] text-foreground">
          {onlyCar ? `${onlyCar.name} has no setup yet` : "None of your cars have a setup yet"}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          Add one and the Engineer talks about your actual springs, camber and droop instead of
          generalities — and every change you make gets tracked run to run.
        </p>

        <div className="mt-3">
          <UploadSetupSheetBar cars={setups.cars} />
        </div>
      </CardPanel>
    );
  }

  return (
    <CardPanel contentClassName="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Setups</Eyebrow>
        <UploadSetupSheetBar cars={setups.cars} trigger="link" label="New setup" />
      </div>

      <ul className="-mx-1">
        {setups.cars.map((car) => (
          <li key={car.id} className="border-b border-border/60 last:border-0">
            <Link
              href={
                car.current
                  ? // Run snapshots are immutable history, so the row opens the read-only sheet
                    // (it offers Edit itself when the setup is a saved baseline).
                    `/cars/${car.id}/setups/${car.current.id}`
                  : `/cars/${car.id}/setups/new`
              }
              className="tap-active flex items-center gap-3 px-1 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{car.name}</span>
                <span className="block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {car.current
                    ? `${car.current.name} · ${car.current.dateLabel}`
                    : "No runs yet — build a setup"}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </CardPanel>
  );
}
