import "server-only";

/**
 * Deterministic roll-centre *qualitative* hints for setup compare rows.
 * Matches `content/vehicle-dynamics/roll-centre.md` + Engineer system rules.
 *
 * Convention: values are shim stack thickness (mm). `primary` and `compare` are the two runs'
 * values; change **compare → primary** means deltaMm = primaryMm − compareMm (positive = raised stack on primary).
 */

const UPPER_INNER_KEYS = new Set([
  "upper_inner_shims_ff",
  "upper_inner_shims_fr",
  "upper_inner_shims_rf",
  "upper_inner_shims_rr",
]);

const UNDER_LOWER_ARM_KEYS = new Set([
  "under_lower_arm_shims_ff",
  "under_lower_arm_shims_fr",
  "under_lower_arm_shims_rf",
  "under_lower_arm_shims_rr",
]);

export type ShimDirectionCompareToPrimary = "raise" | "lower" | "unchanged" | "unknown";

export type RcEffectHint = {
  key: string;
  label: string;
  compareValue: string;
  primaryValue: string;
  /** primaryMm − compareMm; positive = thicker stack on primary vs compare. */
  deltaMm: number | null;
  shimDirectionCompareToPrimary: ShimDirectionCompareToPrimary;
  /** One line; model should prefer this over inventing RC sign. */
  rcEffectLine: string;
};

/** Exported for deterministic axle net notes; same rules as rcEffectHints. */
export function parseSetupShimMm(raw: string): number | null {
  const t = raw.trim();
  if (!t || t === "—" || t === "-") return null;
  const cleaned = t.replace(/mm/gi, "").replace(",", ".").trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const EPS = 1e-4;

function parseMm(raw: string): number | null {
  return parseSetupShimMm(raw);
}

/** Merged FF+FR / RF+RR rows use labels from collapseSetupDiffForEngineer. */
function rollCentreCornerPhrase(label: string): string {
  if (label.includes("both corners") && /front/i.test(label)) {
    return "the front corners (FF & FR)";
  }
  if (label.includes("both corners") && /rear/i.test(label)) {
    return "the rear corners (RF & RR)";
  }
  return "this corner";
}

function directionFromDelta(delta: number): ShimDirectionCompareToPrimary {
  if (Math.abs(delta) < EPS) return "unchanged";
  return delta > 0 ? "raise" : "lower";
}

export function buildRcEffectHintsFromChangedRows(
  rows: Array<{ key: string; label: string; primary: string; compare: string }>
): RcEffectHint[] {
  const out: RcEffectHint[] = [];

  for (const row of rows) {
    const { key, label, primary: pv, compare: cv } = row;
    if (!UPPER_INNER_KEYS.has(key) && !UNDER_LOWER_ARM_KEYS.has(key)) continue;

    const primaryMm = parseMm(pv);
    const compareMm = parseMm(cv);
    if (primaryMm == null || compareMm == null) {
      out.push({
        key,
        label,
        compareValue: cv,
        primaryValue: pv,
        deltaMm: null,
        shimDirectionCompareToPrimary: "unknown",
        rcEffectLine:
          key.startsWith("upper_inner")
            ? "Upper inner shim change (could not parse mm); use vehicleDynamicsKb for upper inner vs RC."
            : "Under lower arm shim change (could not parse mm); use vehicleDynamicsKb for inner lower vs RC.",
      });
      continue;
    }

    const delta = primaryMm - compareMm;
    const dir = directionFromDelta(delta);

    if (dir === "unchanged") continue;

    const cornerPhrase = rollCentreCornerPhrase(label);

    if (UPPER_INNER_KEYS.has(key)) {
      // KB: raising upper inner lowers RC; lowering upper inner raises RC.
      const rcEffectLine =
        dir === "raise"
          ? `Raising upper inner stack (compare → primary) lowers roll centre on ${cornerPhrase}.`
          : `Lowering upper inner stack (compare → primary) raises roll centre on ${cornerPhrase}.`;
      out.push({
        key,
        label,
        compareValue: cv,
        primaryValue: pv,
        deltaMm: delta,
        shimDirectionCompareToPrimary: dir,
        rcEffectLine,
      });
      continue;
    }

    // UNDER_LOWER_ARM_KEYS — KB: raising inner lower-arm stack raises RC.
    const rcEffectLine =
      dir === "raise"
        ? `Raising under–lower-arm stack (compare → primary) raises roll centre on ${cornerPhrase}.`
        : `Lowering under–lower-arm stack (compare → primary) lowers roll centre on ${cornerPhrase}.`;
    out.push({
      key,
      label,
      compareValue: cv,
      primaryValue: pv,
      deltaMm: delta,
      shimDirectionCompareToPrimary: dir,
      rcEffectLine,
    });
  }

  return out;
}
