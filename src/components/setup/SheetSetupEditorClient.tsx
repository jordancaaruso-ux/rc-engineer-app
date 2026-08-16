"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { SheetFillSurface, type SheetFillPlan } from "@/components/setup/SheetFillSurface";
import { SheetGeometryStrip } from "@/components/rollCenter/SheetGeometryStrip";
import { SetupEditorSaveBar } from "@/components/setup/SetupEditorSaveBar";
import { useSetupEditorSave } from "@/components/setup/useSetupEditorSave";
import {
  storedValuesToSurface,
  surfaceValuesToStored,
} from "@/lib/setupSheetModels/sheetSurfaceValues";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSaveMode } from "@/lib/setup/setupSaveMode";

/**
 * Edit one of the driver's setups ON ITS SHEET — the calibrated-chassis counterpart of
 * `LibrarySetupEditorClient`, same endpoints, same save doors. The chassis's fill surface decides
 * which editor a driver gets; a setup must read and edit on the same surface it was filled on, or
 * values would appear to move between the two views.
 *
 * Values cross the same bridge as the fill flow (`sheetSurfaceValues`), so a PATCH from here
 * stores byte-compatible shapes with a form edit — the change list cannot tell them apart.
 */

export function SheetSetupEditorClient({
  carId,
  setupId,
  setupName,
  saveMode,
  setupSheetModelId,
  editionBlankId,
  initialValues,
  templateKey,
}: {
  carId: string;
  setupId: string;
  /** Names the copy when this setup is forked, and seeds Rename. */
  setupName?: string | null;
  saveMode: SetupSaveMode;
  setupSheetModelId: string;
  /** The EDITION this setup's keys are written on, when not the primary blank. See `sheetBlankResolve`. */
  editionBlankId?: string | null;
  initialValues: SetupSnapshotData;
  /** Chassis-type key, for the computed-geometry strip. No key, no strip. */
  templateKey?: string | null;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    storedValuesToSurface(initialValues)
  );
  const planRef = useRef<SheetFillPlan | null>(null);
  /** The plan as state too, so the geometry strip redraws when it lands. Fires once. */
  const [planFields, setPlanFields] = useState<SheetFillPlan["fields"] | null>(null);

  const toStored = useCallback((surface: Record<string, string>): Record<string, unknown> => {
    const plan = planRef.current;
    // No plan yet means no boxes have been drawn, so nothing can have been edited — but fail safe.
    return plan ? surfaceValuesToStored(surface, plan.fields) : surface;
  }, []);

  /*
   * Geometry reads the boxes as they stand; the delta counts from the setup as it was opened, so it
   * reads "what I have changed in this edit". `initialValues` is already in stored shapes.
   */
  const geometryValue = useMemo(
    () => (planFields ? surfaceValuesToStored(values, planFields) : null),
    [values, planFields]
  );

  const getData = useCallback(() => toStored(values), [toStored, values]);
  const save = useSetupEditorSave({
    carId,
    setupId,
    setupName,
    saveMode,
    values,
    getData,
  });

  return (
    <div className="space-y-3">
      {geometryValue ? (
        <SheetGeometryStrip
          value={geometryValue}
          baselineValue={initialValues}
          templateKey={templateKey}
          editionBlankId={editionBlankId}
          labLabels={{ s: setupName ?? "This setup", g: "As opened" }}
          labOrigin={{ setupSheetModelId, source: { kind: "setup", id: setupId } }}
        />
      ) : null}
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan${editionBlankId ? `?blank=${encodeURIComponent(editionBlankId)}` : ""}`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page${editionBlankId ? `?blank=${encodeURIComponent(editionBlankId)}` : ""}`}
        initialValues={values}
        // Handed back on some renders without an edit behind it (StrictMode remounts the surface's
        // notify effect). Harmless now: the bar compares values rather than counting these calls.
        onChange={setValues}
        onPlanLoaded={(p) => {
          planRef.current = p;
          setPlanFields(p.fields);
        }}
      />
      {/* Last, not first: the bar rides the bottom of the screen, and `position: sticky` with a
          `bottom` offset only holds an element that sits at the END of its container. */}
      <SetupEditorSaveBar save={save} />
    </div>
  );
}
