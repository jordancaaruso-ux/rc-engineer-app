import type { FieldCompareResult } from "@/lib/setupCompare/types";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";

function formatSignedDelta(delta: number): string {
  const rounded =
    Math.abs(delta) >= 100 ? delta.toFixed(0) : Math.abs(delta) >= 10 ? delta.toFixed(1) : delta.toFixed(2);
  const trimmed = rounded.replace(/\.?0+$/, "");
  if (delta > 0) return `+${trimmed}`;
  if (delta < 0) return trimmed;
  return "0";
}

/** Short suffix for inline setup compare, e.g. `(+0.3)` or `(Δ 2)`. */
export function formatSetupCompareDeltaSuffix(result: FieldCompareResult | null | undefined): string | null {
  if (!result || result.areEqual) return null;

  const reasonDelta = result.severityReason.match(/^Δ=([\d.eE+-]+)/);
  if (reasonDelta) {
    const magnitude = parseFloat(reasonDelta[1]);
    if (Number.isFinite(magnitude)) {
      const an = parseNumericFromSetupString(result.normalizedA, { allowKSuffix: false });
      const bn = parseNumericFromSetupString(result.normalizedB, { allowKSuffix: false });
      if (an != null && bn != null) return `(${formatSignedDelta(an - bn)})`;
      return `(Δ ${magnitude})`;
    }
  }

  const an = parseNumericFromSetupString(result.normalizedA, { allowKSuffix: false });
  const bn = parseNumericFromSetupString(result.normalizedB, { allowKSuffix: false });
  if (an != null && bn != null) return `(${formatSignedDelta(an - bn)})`;

  return null;
}
