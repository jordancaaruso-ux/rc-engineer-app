import { normalizeSetupData, type SetupSnapshotData, type SetupSnapshotValue } from "@/lib/runSetup";
import { setupValueToNumber } from "@/lib/setup/parseSetupNumeric";
import {
  computeSetupGeometryDerivedMetrics,
  isSetupGeometryDerivedKey,
  type SetupGeometryDerivedMetrics,
} from "@/lib/setupAggregations/setupGeometryDerivedMetrics";

/**
 * How the published baselines were narrowed to the ones that apply to this run.
 *  `matched`        — the run's surface is known and at least one sheet is tagged with it.
 *  `untagged_only`  — the run's surface is known but no sheet claims a surface; untagged sheets are
 *                     treated as applying anywhere, so they're used with that caveat.
 *  `mixed`          — the run's surface is unknown, so every sheet is in play and the range may
 *                     span asphalt and carpet. The Engineer must say so rather than lean on it.
 */
export type BaseSetupSurfaceScope = "matched" | "untagged_only" | "mixed";

/** Which published baselines a car's position bands are measured against. */
export type BaseSetupRef = {
  modelName: string;
  /** How many baselines survived the surface gate and carried usable values. */
  baselineCount: number;
  /** Their names, kit first — what the Engineer cites instead of "typical". */
  baselineNames: string[];
  /** The surface these sheets are for, when the run pinned one. */
  surface: "asphalt" | "carpet" | null;
  surfaceScope: BaseSetupSurfaceScope;
  /**
   * The one sheet whose grip tag matches this run, when one does. This is the sheet the
   * manufacturer wrote for these exact conditions, so it's the recommendation anchor — the range
   * across the rest only says how far out a value is.
   */
  conditionMatchName: string | null;
};

export type BaseSetupReference = {
  ref: BaseSetupRef;
  sheets: Array<{
    name: string;
    /** True for the sheet matching this run's grip level (at most one). */
    conditionMatch: boolean;
    data: SetupSnapshotData;
    /** Derived geometry (RC heights, arm angles) computed from the sheet, same as for a run. */
    derived: SetupGeometryDerivedMetrics;
  }>;
};

export type BaselineSetupInput = {
  name: string;
  /** `asphalt` | `carpet`, or null when the admin left it as "Any". */
  surface: string | null;
  /** `low` | `medium` | `high`, or null when the admin left it as "Any". */
  gripLevel: string | null;
  data: unknown;
};

/**
 * Build the reference a car's position bands are measured against, from the `BaselineSetup` rows
 * published against its chassis type — kit, manufacturer base sheets, and pro sheets alike.
 *
 * Deliberately not kit-only: a chassis with no kit sheet is a normal case, and a manufacturer that
 * publishes a spread of setups across conditions has already stated the range it considers sane.
 *
 * **Surface is a hard gate, not a preference (founder call 2026-07-29).** A carpet setup and an
 * asphalt setup are different cars — quoting one at a driver on the other is worse than saying
 * nothing. So when the run pins a surface, sheets tagged with the other surface are dropped outright
 * and never averaged in. If that leaves one sheet, one sheet is the honest answer: the caller
 * widens it with the authored step instead of borrowing width from a surface that doesn't apply. If
 * it leaves none, this returns null and the row simply has no bands.
 *
 * Grip is NOT a gate. Low/medium/high sheets for the same surface are the same car tuned across its
 * working range, and that range is exactly what `positionBand` should measure against. The
 * grip-matched sheet is flagged instead, so the Engineer can anchor a recommendation on it while
 * still seeing how far out a value sits.
 *
 * Pure on purpose — the caller supplies the already-loaded rows so this stays testable without a
 * database. Baseline data is stored in `SetupSnapshot.data` shape, so after `normalizeSetupData`
 * its keys line up with the driver's own snapshot for free.
 */
export function buildBaseSetupReference(params: {
  baselines: ReadonlyArray<BaselineSetupInput>;
  modelName: string;
  /** The run's surface, when known. Null means we can't gate and the range may mix surfaces. */
  runSurface: "asphalt" | "carpet" | null;
  /** The run's resolved grip bucket. "any"/unknown simply matches no sheet. */
  runGripLevel: string | null;
}): BaseSetupReference | null {
  const withData = params.baselines.filter((b) => {
    if (b.data == null) return false;
    return Object.keys(normalizeSetupData(b.data)).length > 0;
  });

  let applicable = withData;
  let surfaceScope: BaseSetupSurfaceScope = "mixed";
  if (params.runSurface != null) {
    const sameSurface = withData.filter((b) => b.surface === params.runSurface);
    if (sameSurface.length > 0) {
      applicable = sameSurface;
      surfaceScope = "matched";
    } else {
      // Nothing claims this surface. Untagged sheets apply anywhere, so they're the fallback —
      // but a sheet tagged for the *other* surface never is.
      applicable = withData.filter((b) => b.surface == null);
      surfaceScope = "untagged_only";
    }
  }
  if (applicable.length === 0) return null;

  /**
   * The grip-matched sheet is only an anchor when we know it's for the right surface. With the
   * surface unknown, two sheets can share a grip tag on different surfaces and picking one would be
   * a coin toss presented as the manufacturer's answer — so `mixed` gets a range and no anchor.
   */
  const matchIndex =
    surfaceScope !== "mixed" && params.runGripLevel != null && params.runGripLevel !== "any"
      ? applicable.findIndex((b) => b.gripLevel === params.runGripLevel)
      : -1;

  const sheets = applicable.map((b, i) => {
    const data = normalizeSetupData(b.data);
    return {
      name: b.name,
      conditionMatch: i === matchIndex,
      data,
      derived: computeSetupGeometryDerivedMetrics(data as Record<string, SetupSnapshotValue>),
    };
  });

  return {
    ref: {
      modelName: params.modelName,
      baselineCount: sheets.length,
      baselineNames: sheets.map((s) => s.name),
      surface: params.runSurface,
      surfaceScope,
      conditionMatchName: matchIndex >= 0 ? sheets[matchIndex]!.name : null,
    },
    sheets,
  };
}

/** One sheet's numeric value for a parameter, or null when it doesn't carry a usable number. */
function sheetValueForKey(sheet: BaseSetupReference["sheets"][number], key: string): number | null {
  if (isSetupGeometryDerivedKey(key)) {
    const v = sheet.derived[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return setupValueToNumber(sheet.data[key]);
}

/**
 * Every numeric value the applicable baselines give for one parameter, in sheet order. Empty when
 * none of them carry a usable number there.
 */
export function baseSetupValuesForKey(base: BaseSetupReference, key: string): number[] {
  const out: number[] = [];
  for (const sheet of base.sheets) {
    const v = sheetValueForKey(sheet, key);
    if (v != null) out.push(v);
  }
  return out;
}

/**
 * The value from the sheet written for this run's conditions, when one matched and carries the key.
 * This is what a recommendation should anchor on — the surrounding range only says how far out the
 * driver currently is.
 */
export function baseSetupConditionValueForKey(
  base: BaseSetupReference,
  key: string
): { baselineName: string; value: number } | null {
  const sheet = base.sheets.find((s) => s.conditionMatch);
  if (!sheet) return null;
  const value = sheetValueForKey(sheet, key);
  return value == null ? null : { baselineName: sheet.name, value };
}
