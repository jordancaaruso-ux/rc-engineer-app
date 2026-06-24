import { getBoolFromSetupString } from "@/lib/a800rrSetupRead";
import { CALIBRATION_PAIR_GROUPS } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import type { SetupSnapshotData } from "@/lib/runSetup";

export function formatAdditiveTimingLine(
  additiveType: { displayName: string } | null | undefined,
  warmerTimingMinutes: number | null | undefined
): string | null {
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
  tireSet: { label: string; setNumber: number | null } | null | undefined;
  tireRunNumber: number;
  additiveType?: { displayName: string } | null;
  warmerTimingMinutes?: number | null;
  setupSnapshotData?: unknown;
}): string {
  const base = params.tireSet
    ? `${params.tireSet.label} · Set ${params.tireSet.setNumber ?? "—"} · Run ${params.tireRunNumber}`
    : "—";
  const extras: string[] = [];
  const additive = formatAdditiveTimingLine(params.additiveType, params.warmerTimingMinutes);
  if (additive) extras.push(additive);
  const prep = formatTirePrepSummaryFromSnapshot(params.setupSnapshotData);
  if (prep) extras.push(prep);
  if (extras.length === 0) return base;
  return `${base}${base !== "—" ? " · " : ""}${extras.join(" · ")}`;
}
