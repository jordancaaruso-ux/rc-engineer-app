import { formatRunTiresOneLine } from "@/lib/tires/runTireEnds";
import { getBoolFromSetupString } from "@/lib/a800rrSetupRead";
import { CALIBRATION_PAIR_GROUPS } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import type { SetupSnapshotData } from "@/lib/runSetup";
import { normalizeTirePrep, formatTirePrepLine } from "@/lib/runs/tirePrep";
import type { UnitSystem } from "@/lib/units/unitSystem";

/**
 * Additive + timing line for read surfaces. When a `tirePrep` sequence exists it
 * renders the full ordered applications ("VP · 20m bench + 10m warmers 55°C");
 * otherwise it falls back to the legacy single additive + warmer-minutes line so
 * runs logged before the sequence model still read correctly.
 */
export function formatAdditiveTimingLine(
  additiveType: { displayName: string } | null | undefined,
  warmerTimingMinutes: number | null | undefined,
  tirePrep?: unknown,
  units: UnitSystem = "metric"
): string | null {
  const steps = normalizeTirePrep(tirePrep);
  if (steps.length > 0) {
    return formatTirePrepLine(steps, additiveType?.displayName ?? null, units);
  }
  const parts: string[] = [];
  if (additiveType?.displayName?.trim()) parts.push(additiveType.displayName.trim());
  if (warmerTimingMinutes != null && Number.isFinite(warmerTimingMinutes)) {
    parts.push(`${Math.floor(warmerTimingMinutes)} min warmer`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Summarize checked tire prep booleans from a setup snapshot (for read-only views). */
export function formatTirePrepSummaryFromSnapshot(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const snap = data as SetupSnapshotData;
  const parts: string[] = [];

  for (const g of CALIBRATION_PAIR_GROUPS) {
    if (g.innerKind !== "boolean") continue;
    const frontOn = getBoolFromSetupString(String(snap[g.frontKey] ?? ""));
    const rearOn = getBoolFromSetupString(String(snap[g.rearKey] ?? ""));
    if (!frontOn && !rearOn) continue;
    if (frontOn && rearOn) {
      parts.push(g.label);
    } else if (frontOn) {
      parts.push(`${g.label} F`);
    } else {
      parts.push(`${g.label} R`);
    }
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

export function formatRunTiresDetailLine(params: {
  tireType: { displayName: string } | null | undefined;
  tireAgeKnown?: boolean | null;
  tireRunNumber: number;
  /** The front end of a front/rear run; the three above are then the rear. */
  frontTireType?: { displayName: string } | null;
  frontTireAgeKnown?: boolean | null;
  frontTireRunNumber?: number | null;
  tireFitment?: unknown;
  additiveType?: { displayName: string } | null;
  warmerTimingMinutes?: number | null;
  tirePrep?: unknown;
  setupSnapshotData?: unknown;
  /** The reader's units, for a warmer temperature in the prep. */
  units?: UnitSystem;
}): string {
  // Wear-first identity: the compound + which run this was on the set. Set numbers are
  // internal counters and anchors are retired — neither belongs in run detail lines.
  // A front/rear run names both ends and what they are glued to; a single-tire run reads exactly
  // as it always has (`runTireEnds.ts` decides which a run is, from its own data).
  const base = formatRunTiresOneLine(params, { fitment: true }) ?? "—";
  const extras: string[] = [];
  const additive = formatAdditiveTimingLine(
    params.additiveType,
    params.warmerTimingMinutes,
    params.tirePrep,
    params.units
  );
  if (additive) extras.push(additive);
  const prep = formatTirePrepSummaryFromSnapshot(params.setupSnapshotData);
  if (prep) extras.push(prep);
  if (extras.length === 0) return base;
  return `${base}${base !== "—" ? " · " : ""}${extras.join(" · ")}`;
}
