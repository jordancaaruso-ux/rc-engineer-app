"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useSetUnits, useUnits } from "@/components/providers/UnitsProvider";
import { postSetting, SaveNote, type SaveState } from "@/components/settings/saveState";
import type { UnitSystem } from "@/lib/units/unitSystem";

/**
 * The units switch (founder call 2026-09-24): what temperatures and wind read in.
 *
 * The options name exactly what changes, not "Metric" / "Imperial": an "Imperial" button
 * would promise inches on the setup sheet, and setup numbers never convert. Every open screen
 * changes on the tap (the provider's override); the save and the refresh behind it bring
 * along the few lines the server writes out, like the team feed's "Track temp 20 → 25".
 */
export function UnitsSection() {
  const units = useUnits();
  const setUnits = useSetUnits();
  const router = useRouter();
  const [saving, setSaving] = useState<SaveState>({ kind: "idle" });

  async function choose(next: UnitSystem) {
    if (next === units) return;
    const previous = units;
    setUnits(next);
    const ok = await postSetting("/api/settings/units", { unitSystem: next }, setSaving);
    // A save that never landed goes back to what is stored, so the screen can't claim a
    // unit the next visit won't have.
    if (ok) router.refresh();
    else setUnits(previous);
  }

  return (
    <CardPanel contentClassName="p-0">
      {/* Heading in the card (2026-08-18) — see the note in YouSection. */}
      <div className="eyebrow-band flex items-center justify-between gap-3 px-4">
        <Eyebrow className="mb-0">Units</Eyebrow>
        <SaveNote state={saving} />
      </div>
      <div className="px-4 pb-4 pt-3">
        <SegmentedControl<UnitSystem>
          ariaLabel="Temperature and wind units"
          value={units}
          onChange={(v) => void choose(v)}
          options={[
            { value: "metric", label: "°C · km/h", ariaLabel: "Celsius and kilometres per hour" },
            { value: "imperial", label: "°F · mph", ariaLabel: "Fahrenheit and miles per hour" },
          ]}
        />
      </div>
    </CardPanel>
  );
}
