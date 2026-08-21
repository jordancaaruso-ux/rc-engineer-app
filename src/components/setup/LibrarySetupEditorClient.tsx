"use client";

import { useCallback, useState } from "react";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { SetupEditorSaveBar } from "@/components/setup/SetupEditorSaveBar";
import {
  useSetupEditorSave,
  type SetupEditorSavedResult,
} from "@/components/setup/useSetupEditorSave";
import { useReportSetupEditorState } from "@/components/setup/setupEditorShare";
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
  returnHref,
  onSaved,
  hosted = false,
}: {
  carId: string;
  setupId: string;
  /** Names the copy when this setup is forked, and seeds Rename. */
  setupName?: string | null;
  saveMode: SetupSaveMode;
  initialValues: SetupSnapshotData;
  template: SetupSheetTemplate;
  /** Where a run correction lands. Null when nobody said where they came from. */
  returnHref?: string | null;
  /** Hosted in the run's setup pop-up: take the result in memory instead of navigating. */
  onSaved?: (result: SetupEditorSavedResult) => void;
  /** Lay the save bar out in the flow of a scrolling host rather than fixed to the viewport. */
  hosted?: boolean;
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
    returnHref,
    onSaved,
  });
  // Tells the Share button above the editor where the setup stands. See `setupEditorShare`.
  useReportSetupEditorState(save.dirty, save.savedCount);

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
      <SetupEditorSaveBar save={save} hosted={hosted} />
    </div>
  );
}
