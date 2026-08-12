"use client";

import { useMemo, useState } from "react";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { SheetGeometryStrip } from "@/components/rollCenter/SheetGeometryStrip";
import { SETUP_SHEET_TEMPLATE_A800RR } from "@/lib/setupSheetTemplateId";

/**
 * Drives `SheetGeometryStrip` from a hand-typed A800RR setup, over a real sheet picture.
 * See `src/app/debug/roll-center-strip/page.tsx` for why the two do not match.
 */

/** A plausible A800RR setup, in the sheet's own field keys (see the pack's field map). */
const BASE_SETUP: Record<string, string> = {
  chassis: "C01RS",
  under_lower_arm_shims_ff: "0",
  under_lower_arm_shims_fr: "0",
  under_lower_arm_shims_rf: "0",
  under_lower_arm_shims_rr: "0",
  upper_inner_shims_ff: "0.5",
  upper_inner_shims_fr: "0.5",
  upper_inner_shims_rf: "0.5",
  upper_inner_shims_rr: "0.5",
  under_hub_shims_front: "0",
  under_hub_shims_rear: "0",
  upper_outer_shims_front: "0",
  upper_outer_shims_rear: "0",
  ride_height_front: "5",
  ride_height_rear: "5.5",
  camber_front: "1.8",
  camber_rear: "1",
  wheel_spacer_front: "0",
  wheel_spacer_rear: "0",
};

/** The knobs worth turning by hand — the four the pack lists sensitivities for, front axle. */
const KNOBS: { key: string; label: string; note: string }[] = [
  { key: "under_lower_arm_shims_ff", label: "Under lower arm, front-front leg", note: "+2.2mm RC per mm" },
  { key: "under_hub_shims_front", label: "Under hub, front", note: "+2.1mm RC per mm (sign-inverted)" },
  { key: "upper_inner_shims_ff", label: "Upper inner, front-front leg", note: "−1.0mm RC per mm" },
  { key: "ride_height_front", label: "Ride height, front", note: "+1.2mm RC per mm" },
];

export function RollCenterStripPreview() {
  const [values, setValues] = useState<Record<string, string>>(BASE_SETUP);
  const baseline = useMemo(() => BASE_SETUP, []);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-3 p-3 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Geometry strip over a sheet</h1>
        <p className="text-[13px] text-muted-foreground">
          An A800RR setup drives the strip; an Xray sheet supplies the paper. Change a shim and watch
          the roll centre move. Nothing is saved.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
        {KNOBS.map((k) => (
          <label key={k.key} className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">{k.label}</span>
            <input
              type="number"
              step="0.25"
              value={values[k.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [k.key]: e.target.value }))}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 font-mono text-sm outline-none"
            />
            <span className="text-[10px] text-faint">{k.note}</span>
          </label>
        ))}
      </div>

      <SheetGeometryStrip
        value={values}
        baselineValue={baseline}
        templateKey={SETUP_SHEET_TEMPLATE_A800RR}
        labLabels={{ s: "Preview", g: "As opened" }}
      />

      <SheetFillSurface
        pageImageUrl="/api/debug/sheet-blank?id=xray-x4-2026"
        planUrl="/api/debug/sheet-plan?id=xray-x4-2026"
        readOnly
      />
    </main>
  );
}
