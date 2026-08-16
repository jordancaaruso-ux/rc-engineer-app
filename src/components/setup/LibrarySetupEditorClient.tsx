"use client";

import { useCallback, useState } from "react";
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
  /** Names the copy when this setup is forked, and seeds Rename. */
  setupName?: string | null;
  saveMode: SetupSaveMode;
  initialValues: SetupSnapshotData;
  template: SetupSheetTemplate;
}) {
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);

  const getData = useCallback(() => values as Record<string, unknown>, [values]);
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
      <SetupSheetView
        value={values}
        template={template}
        enableFieldSearch
        // Every field commits on blur whether or not it was typed in, so a stray tap lands here
        // with the values unchanged. The bar compares, so that is a no-op rather than "unsaved".
        onChange={setValues}
      />
      {/* Last, not first: the bar rides the bottom of the screen, and `position: sticky` with a
          `bottom` offset only holds an element that sits at the END of its container. */}
      <SetupEditorSaveBar save={save} />
    </div>
  );
}
