"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { UnitSystem } from "@/lib/units/unitSystem";

type UnitsContextValue = {
  units: UnitSystem;
  setUnits: (next: UnitSystem) => void;
};

const UnitsContext = createContext<UnitsContextValue | null>(null);

/**
 * The driver's units for every client screen (`lib/units/unitSystem.ts`), resolved on the
 * server in the root layout so the first paint is already in the right unit.
 *
 * The Settings switch sets an override for the rest of the visit, so every open screen changes
 * the moment it is tapped, and a refresh that lands before the save can't flip it back.
 */
export function UnitsProvider({ initial, children }: { initial: UnitSystem; children: ReactNode }) {
  const [override, setOverride] = useState<UnitSystem | null>(null);
  const units = override ?? initial;
  const value = useMemo(() => ({ units, setUnits: setOverride }), [units]);
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

/**
 * Metric outside the provider: that is the unit everything is stored in, so a screen that
 * somehow renders without it shows correct, labelled numbers, only unconverted.
 */
export function useUnits(): UnitSystem {
  return useContext(UnitsContext)?.units ?? "metric";
}

export function useSetUnits(): (next: UnitSystem) => void {
  const ctx = useContext(UnitsContext);
  return ctx?.setUnits ?? (() => {});
}
