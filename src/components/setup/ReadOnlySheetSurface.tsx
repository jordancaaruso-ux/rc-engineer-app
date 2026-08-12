"use client";

import { useMemo } from "react";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { SheetGeometryStrip } from "@/components/rollCenter/SheetGeometryStrip";
import { storedValuesToSurface } from "@/lib/setupSheetModels/sheetSurfaceValues";

/**
 * A saved setup shown ON THE SHEET — the driver's own paper with their values in its boxes.
 *
 * The founder's ruling (2026-08-11 interview): on a chassis whose sheet the app can draw, the
 * sheet IS the setup view, everywhere a setup is looked at. The field list stays only where the
 * question is "what changed since last time", which the session view answers.
 *
 * A thin wrapper over `SheetFillSurface` in its read-only mode: same page picture, same box
 * geometry, same value drawing — so what a setup looks like when read is exactly what it looked
 * like when filled. Values arrive in STORED shapes and go through the same bridge the fill flow
 * uses, in the other direction.
 */
export function ReadOnlySheetSurface({
  setupSheetModelId,
  values,
  templateKey,
  baselineValue,
  labLabels,
}: {
  setupSheetModelId: string;
  /** The snapshot's data as stored — arrays, preset objects, numbers. */
  values: Record<string, unknown>;
  /** Chassis-type key. Without it there is no geometry strip — see `SheetGeometryStrip`. */
  templateKey?: string | null;
  /** What the geometry deltas count from, where the surface knows of one. */
  baselineValue?: Record<string, unknown> | null;
  labLabels?: { s?: string; g?: string };
}) {
  const surfaceValues = useMemo(() => storedValuesToSurface(values), [values]);
  return (
    <div className="space-y-2">
      {/* Chrome above the paper, never ink on it: the sheet stays the driver's own sheet. */}
      <SheetGeometryStrip
        value={values}
        baselineValue={baselineValue}
        templateKey={templateKey}
        labLabels={labLabels}
      />
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
        initialValues={surfaceValues}
        readOnly
      />
    </div>
  );
}
