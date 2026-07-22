import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { UploadSetupSheetBar } from "@/components/setup/UploadSetupSheetBar";
import type { SetupSheetPrompt } from "@/lib/setup/setupSheetPrompt";

/**
 * "Add a setup" prompt — docs/ONBOARDING_NORTH_STAR.md.
 *
 * The set-up wizard no longer has a sheet step (founder 2026-07-22: building a
 * setup before the first run is too much work), so this carries the ask instead.
 * Founder-locked shape: it sits on the dashboard from the moment they have a car,
 * has NO Ignore button, and disappears on its own once a setup exists — the same
 * self-retiring rule as the resume card, so it can't become a permanent nag.
 *
 * The action is the Garage hub's own bar, not a link out: one tap gets the car
 * picker, the upload/photo/paste doors for a readable chassis, and the fill-it-in
 * flow for every other chassis, with no routing logic duplicated here.
 */
export function DashboardSetupSheetCard({ prompt }: { prompt: SetupSheetPrompt }) {
  const onlyCar = prompt.cars.length === 1 ? prompt.cars[0]! : null;

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
        <UploadSetupSheetBar cars={prompt.cars} />
      </div>
    </CardPanel>
  );
}
