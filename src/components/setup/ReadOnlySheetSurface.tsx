"use client";

import { useMemo } from "react";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { SheetGeometryStrip } from "@/components/rollCenter/SheetGeometryStrip";
import { storedValuesToSurface } from "@/lib/setupSheetModels/sheetSurfaceValues";
import type { LabSource } from "@/lib/rollCenter/labState";

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
  editionBlankId,
  values,
  templateKey,
  baselineValue,
  labLabels,
  labSource,
}: {
  setupSheetModelId: string;
  /**
   * Which of the chassis's sheets these values are written on, when it is not the primary blank —
   * a rebuilt EDITION's own boxes and page pictures. The server page picks it by key overlap
   * (`sheetBlankResolve`); absent, the primary draws, exactly as before editions existed.
   */
  editionBlankId?: string | null;
  /** The snapshot's data as stored — arrays, preset objects, numbers. */
  values: Record<string, unknown>;
  /** Chassis-type key. Without it there is no geometry strip — see `SheetGeometryStrip`. */
  templateKey?: string | null;
  /** What the geometry deltas count from, where the surface knows of one. */
  baselineValue?: Record<string, unknown> | null;
  labLabels?: { s?: string; g?: string };
  /** Which stored row this is, so the Lab can draw its sheet and offer a way back. */
  labSource?: LabSource | null;
}) {
  const surfaceValues = useMemo(() => storedValuesToSurface(values), [values]);
  return (
    <div className="space-y-2">
      {/* Chrome above the paper, never ink on it: the sheet stays the driver's own sheet. */}
      <SheetGeometryStrip
        value={values}
        baselineValue={baselineValue}
        templateKey={templateKey}
        editionBlankId={editionBlankId}
        labLabels={labLabels}
        labOrigin={{ setupSheetModelId, source: labSource ?? null }}
      />
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan${editionBlankId ? `?blank=${encodeURIComponent(editionBlankId)}` : ""}`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page${editionBlankId ? `?blank=${encodeURIComponent(editionBlankId)}` : ""}`}
        initialValues={surfaceValues}
        readOnly
      />
    </div>
  );
}
