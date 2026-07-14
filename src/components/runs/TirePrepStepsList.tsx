import {
  AdditiveDropIcon,
  WarmerSteamIcon,
  TowelRollIcon,
} from "@/components/runs/TirePrepIcons";
import {
  normalizeTirePrep,
  tirePrepFromLegacy,
  type TirePrepStep,
} from "@/lib/runs/tirePrep";

/**
 * Read-only tire-prep step list (sessions prep panel + expanded-run "Tire prep"
 * well): numbered mono lines with the prep glyphs lit per step.
 *
 *   1  [drop]              20m · additive
 *   2  [drop][steam][roll] 10m · additive · warmers 55° · towels
 *
 * Legacy runs (pre-applications data) synthesize a single warmer step from
 * `warmerTimingMinutes` so history still reads.
 */
export function resolveTirePrepSteps(run: {
  tirePrep?: unknown;
  warmerTimingMinutes?: number | null;
  additiveType?: { displayName: string } | null;
}): TirePrepStep[] {
  const steps = normalizeTirePrep(run.tirePrep);
  if (steps.length > 0) return steps;
  return tirePrepFromLegacy(run.warmerTimingMinutes, Boolean(run.additiveType));
}

function stepLine(s: TirePrepStep): string {
  const bits: string[] = [];
  if (s.minutes != null && s.minutes > 0) bits.push(`${s.minutes}m`);
  bits.push(s.appliedAdditive ? "additive" : "no sauce");
  if (s.warmers) {
    bits.push(
      `warmers${s.temperatureC != null ? ` ${s.temperatureC}°` : ""}${s.towels ? " · towels" : ""}`
    );
  }
  return bits.join(" · ");
}

export function TirePrepStepsList({ steps }: { steps: TirePrepStep[] }) {
  if (steps.length === 0) {
    return <p className="text-xs text-muted-foreground">No tire prep logged.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {steps.map((s, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          <span className="w-3 flex-none text-faint">{i + 1}</span>
          <span className="flex flex-none items-center gap-0.5 text-accent">
            {s.appliedAdditive ? <AdditiveDropIcon className="h-3 w-3" /> : null}
            {s.warmers ? <WarmerSteamIcon className="h-3 w-3" /> : null}
            {s.towels ? <TowelRollIcon className="h-3 w-3" /> : null}
          </span>
          <span className="min-w-0">{stepLine(s)}</span>
        </div>
      ))}
    </div>
  );
}
