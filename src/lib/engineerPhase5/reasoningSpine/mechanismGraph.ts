import "server-only";

import { PARAMETER_EFFECT_CATALOG } from "@/lib/engineerPhase5/parameterEffects/catalog";
import { getParametersForIntent } from "@/lib/engineerPhase5/parameterEffects/query";
import type { Outcome, OutcomeDirection } from "@/lib/engineerPhase5/parameterEffects/types";
import { mechanismsForKey, type SetupMechanismId } from "@/lib/engineerPhase5/setupMechanismMap";

export type MechanismGraphGroup = {
  mechanismId: SetupMechanismId | null;
  parameterKeys: string[];
  kbSources: string[];
};

/**
 * Group catalog entries by primary mechanism for deduped candidate generation.
 * Dormant-safe when catalog is empty.
 */
export function groupCatalogByMechanism(
  outcome: Outcome,
  direction: OutcomeDirection
): MechanismGraphGroup[] {
  const candidates = getParametersForIntent(outcome, direction);
  const groups = new Map<string, MechanismGraphGroup>();

  for (const { entry } of candidates) {
    const mechanismId = mechanismsForKey(entry.parameterKey)[0]?.mechanism ?? null;
    const key = mechanismId ?? entry.parameterKey;
    const g = groups.get(key) ?? {
      mechanismId,
      parameterKeys: [],
      kbSources: [],
    };
    if (!g.parameterKeys.includes(entry.parameterKey)) {
      g.parameterKeys.push(entry.parameterKey);
    }
    const cite = `${entry.kbSource}#${entry.kbSection}`;
    if (!g.kbSources.includes(cite)) g.kbSources.push(cite);
    groups.set(key, g);
  }

  return [...groups.values()];
}

/** Catalog coverage stats for debugging / coverage reports. */
export function mechanismGraphCoverageStats(): {
  catalogEntryCount: number;
  distinctMechanisms: number;
} {
  const mechanisms = new Set<string>();
  for (const entry of PARAMETER_EFFECT_CATALOG) {
    const m = mechanismsForKey(entry.parameterKey)[0]?.mechanism;
    mechanisms.add(m ?? entry.parameterKey);
  }
  return {
    catalogEntryCount: PARAMETER_EFFECT_CATALOG.length,
    distinctMechanisms: mechanisms.size,
  };
}
