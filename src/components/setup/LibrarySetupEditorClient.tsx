"use client";

import { useCallback, useRef, useState } from "react";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { SetupEditorSaveBar } from "@/components/setup/SetupEditorSaveBar";
import { useSetupEditorSave } from "@/components/setup/useSetupEditorSave";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSaveMode } from "@/lib/setup/setupSaveMode";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/**
 * Grid editor for one of the driver's setups. What a save means comes in as `saveMode`; this file
 * only draws the grid.
 *
 * Uses the existing `SetupSheetView` unchanged — a library setup and a run setup are the same
 * shape, so they get the same sheet.
 */

export function LibrarySetupEditorClient({
  carId,
  setupId,
  setupName,
  saveMode,
  initialValues,
  template,
}: {
  carId: string;
  setupId: string;
  /** Seeds the name prompt when copying this setup. */
  setupName?: string | null;
  saveMode: SetupSaveMode;
  initialValues: SetupSnapshotData;
  template: SetupSheetTemplate;
}) {
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);
  // Skip the save that the initial render would otherwise trigger.
  const dirtyRef = useRef(false);

  const getData = useCallback(() => values as Record<string, unknown>, [values]);
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
      <SetupSheetView
        value={values}
        template={template}
        enableFieldSearch
        onChange={(next) => {
          dirtyRef.current = true;
          setValues(next);
        }}
      />
    </div>
  );
}
