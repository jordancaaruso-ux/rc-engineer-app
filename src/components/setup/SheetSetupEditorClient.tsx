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
  initialValues,
  templateKey,
}: {
  carId: string;
  setupId: string;
  /** Seeds the name prompt when copying this setup. */
  setupName?: string | null;
  saveMode: SetupSaveMode;
  setupSheetModelId: string;
  initialValues: SetupSnapshotData;
  /** Chassis-type key, for the computed-geometry strip. No key, no strip. */
  templateKey?: string | null;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    storedValuesToSurface(initialValues)
  );
  // Skip the save that the initial render would otherwise trigger.
  const dirtyRef = useRef(false);
  const planRef = useRef<SheetFillPlan | null>(null);
  /** The plan as state too, so the geometry strip redraws when it lands. Fires once. */
  const [planFields, setPlanFields] = useState<SheetFillPlan["fields"] | null>(null);

  const toStored = useCallback((surface: Record<string, string>): Record<string, unknown> => {
    const plan = planRef.current;
    // No plan yet means nothing has been drawn, so nothing can be dirty — but fail safe anyway.
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
    dirtyRef,
  });

  return (
    <div className="space-y-3">
      <SetupEditorSaveBar save={save} />
      {geometryValue ? (
        <SheetGeometryStrip
          value={geometryValue}
          baselineValue={initialValues}
          templateKey={templateKey}
          labLabels={{ s: setupName ?? "This setup", g: "As opened" }}
          labOrigin={{ setupSheetModelId, source: { kind: "setup", id: setupId } }}
        />
      ) : null}
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
        initialValues={values}
        onChange={(next) => {
          dirtyRef.current = true;
          setValues(next);
        }}
        onPlanLoaded={(p) => {
          planRef.current = p;
          setPlanFields(p.fields);
        }}
      />
    </div>
  );
}
