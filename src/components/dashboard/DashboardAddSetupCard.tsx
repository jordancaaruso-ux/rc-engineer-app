import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { UploadSetupSheetBar, type UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";

/**
 * The "add a setup sheet" ask — docs/ONBOARDING_NORTH_STAR.md. Appears once a driver has a car,
 * retires for good the moment a setup exists, and has no Ignore button.
 *
 * It briefly (2026-07-29) carried a second job: a permanent list of what each car was running.
 * That was retired the same week — the reworked Garage leads to setups well enough that the list
 * was only duplicating it, and the dashboard's boundary rule says now & next, not an index.
 * Suppressed while the Get-set-up card is up, which owns the ask while it lives.
 */
export function DashboardAddSetupCard({ cars }: { cars: UploadSetupCar[] }) {
  const onlyCar = cars.length === 1 ? cars[0]! : null;

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
        <UploadSetupSheetBar cars={cars} />
      </div>
    </CardPanel>
  );
}
