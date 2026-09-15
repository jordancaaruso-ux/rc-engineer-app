import { normalizeSetupData } from "@/lib/runSetup";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";

/**
 * How the Engineer's data blocks read a setup sheet and say what moved between two of them.
 * Shared by the per-run block (driverData.ts) and the range block (driverHistory.ts) so the
 * two can never disagree about what counts as a change.
 */

export function fmtSetupValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length > 0 && s.length <= 60 ? s : null;
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
}

/** `front_spring_rate_gf_mm` -> `front spring rate gf mm` — readable without inventing a label. */
export function readableSetupKey(key: string): string {
  return key.replace(/[_\-]+/g, " ").trim();
}

/** The tuning keys only — the blob also carries tyres, battery, body and free text. */
export function tuningValues(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(normalizeSetupData(data))) {
    if (!isTuningComparisonKey(key)) continue;
    const value = fmtSetupValue(raw);
    if (value) out[key] = value;
  }
  return out;
}

/**
 * `1` and `1.0`, or `STD` and `std`, are the same setting written twice — not a change the
 * driver made. Sheets store what was keyed, and canonicalising the box labels (2026-09-01)
 * recased a batch of preset values, so a naive string compare reports a day's worth of
 * changes nobody touched. Numbers compare as numbers, text ignores case and padding.
 */
export function sameSetupValue(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * What moved between two sheets. Null — not an empty list — when either side has no
 * readable setup: only a calibrated sheet gives values, and "nothing changed" and "we
 * cannot see the setup" are different facts (founder call 2026-09-01).
 */
export function diffTuning(
  prev: Record<string, string>,
  next: Record<string, string>
): string[] | null {
  if (Object.keys(prev).length === 0 || Object.keys(next).length === 0) return null;
  const changes: string[] = [];
  for (const key of [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort()) {
    if (sameSetupValue(prev[key], next[key])) continue;
    changes.push(`${readableSetupKey(key)} ${prev[key] ?? "—"} → ${next[key] ?? "—"}`);
  }
  return changes;
}
