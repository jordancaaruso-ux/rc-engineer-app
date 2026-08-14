import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { KeepSetupButton } from "@/components/setup/KeepSetupButton";
import type { CarCurrentSetup } from "@/lib/setup/getCarSetupHistory";

/**
 * What the car is set up with right now — the newest run's setup. Nothing to maintain: log a run
 * and this follows. The chips are what that run changed on the chassis, tires and additive excluded.
 */

const MAX_CHIPS = 5;

export function CarCurrentSetupCard({
  carId,
  current,
}: {
  carId: string;
  current: CarCurrentSetup;
}) {
  return (
    <SurfaceCard variant="panel" contentClassName="space-y-3">
      <Eyebrow>On the car now</Eyebrow>

      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-foreground">{current.title}</p>
        <p className="ui-caption mt-0.5 truncate tabular-nums">{current.meta}</p>
      </div>

      {current.changedLabels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {current.changedLabels.slice(0, MAX_CHIPS).map((label) => (
            <span
              key={label}
              className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
            >
              {label}
            </span>
          ))}
          {current.changedLabels.length > MAX_CHIPS ? (
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              +{current.changedLabels.length - MAX_CHIPS} more
            </span>
          ) : null}
        </div>
      ) : (
        <p className="ui-caption">Unchanged from the run before it.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={`/cars/${carId}/setups/${current.setupId}`}>View sheet</ButtonLink>
        <KeepSetupButton
          setupId={current.setupId}
          name={current.title}
          initialSaved={current.saved}
        />
        <ButtonLink href={`/runs/${current.runId}`} variant="outline">
          Open run
        </ButtonLink>
      </div>
    </SurfaceCard>
  );
}
