"use client";

/**
 * The driver's own setup sheet, as the Geometry Lab's input surface.
 *
 * ============================== WHY THE SHEET AND NOT ONLY SLIDERS ==============================
 *
 * The Lab's sliders are an abstraction over the sheet: four sliders per axle standing in for eight
 * per-leg field keys, at a fixed 0.25mm detent. That is fast, and it stays the default. What it is
 * not is *the thing on the pit table*. A driver reading a stack off their car is holding a sheet with
 * a box for it, and the box is where the number belongs — so on a chassis whose sheet the app can
 * draw, the sheet is offered as a second way in. Same state underneath, both directions live.
 *
 * ============================== WHY IT NEEDS THE WHOLE SETUP ==============================
 *
 * A Lab URL carries nineteen geometry keys. An A800RR sheet has getting on for three hundred boxes.
 * Drawing this surface from the slice alone would show a driver their own sheet with everything but
 * the shims rubbed out — so this component refuses to render without the full snapshot behind it,
 * and the Lab only offers the Sheet tab once it has one.
 *
 * ============================== WHY IT RE-SEEDS ON MOUNT, NOT ON EDIT ==============================
 *
 * `SheetFillSurface` reads `initialValues` once and holds its own state after that, because a value
 * set that changed under it would re-render 300 boxes on every keystroke, and remounting to force a
 * re-read resets zoom, pan and page — a view that shifts by a pixel makes every box look like it
 * moved. So the Lab unmounts this pane when it switches back to the sliders and mounts it fresh on the
 * way in. Slider edits reach the sheet at that moment; sheet edits reach the sliders continuously, which
 * is the direction that actually needs to be live.
 */

import { useCallback, useMemo, useRef } from "react";
import { SheetFillSurface, type SheetFillPlan } from "@/components/setup/SheetFillSurface";
import {
  storedValuesToSurface,
  surfaceValuesToStored,
} from "@/lib/setupSheetModels/sheetSurfaceValues";
import { extractGeometryFields, type LabFields } from "@/lib/rollCenter/labState";

export function LabSheetPane({
  setupSheetModelId,
  values,
  onChange,
}: {
  setupSheetModelId: string;
  /** The whole setup in STORED shapes — arrays, preset objects, numbers. */
  values: Record<string, unknown>;
  /**
   * Every box edit, reported as both halves: the geometry slice the solve reads, and the complete
   * stored setup a save has to write. Handing back only the slice is what would quietly drop the
   * other 260 boxes on the way to the database.
   */
  onChange: (next: { fields: LabFields; fullData: Record<string, unknown> }) => void;
}) {
  /* Seeds the surface once, on mount — see the header note about why this must not be reactive. */
  const initialSurface = useMemo(() => storedValuesToSurface(values), [values]);
  const planRef = useRef<SheetFillPlan | null>(null);

  const handleChange = useCallback(
    (surface: Record<string, string>) => {
      const plan = planRef.current;
      // No plan means nothing has been drawn yet, so there is nothing trustworthy to convert.
      if (!plan) return;
      const fullData = surfaceValuesToStored(surface, plan.fields);
      onChange({ fields: extractGeometryFields(fullData), fullData });
    },
    [onChange]
  );

  return (
    <SheetFillSurface
      planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
      pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
      initialValues={initialSurface}
      onChange={handleChange}
      onPlanLoaded={(p) => {
        planRef.current = p;
      }}
      /*
       * Deliberately no `storageKey`. The fill surfaces draft to storage because a sheet is filled
       * over a whole day; the Lab is a what-if bench, and a half-finished experiment restoring itself
       * days later over a real setup is the opposite of what a driver wants.
       */
    />
  );
}
