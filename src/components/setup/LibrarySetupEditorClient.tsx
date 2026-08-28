"use client";

import { useCallback, useState } from "react";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { SetupEditorSaveBar } from "@/components/setup/SetupEditorSaveBar";
import {
  useSetupEditorSave,
  useReportHostedSave,
  type HostedSetupSave,
  type SetupEditorSavedResult,
} from "@/components/setup/useSetupEditorSave";
import { useReportSetupEditorState } from "@/components/setup/setupEditorShare";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
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
  onSaveStateChange,
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
  /** Publishes unsaved work to a host that has exits of its own. See `useReportHostedSave`. */
  onSaveStateChange?: (state: HostedSetupSave | null) => void;
  /** Lay the save bar out in the flow of a scrolling host rather than fixed to the viewport. */
  hosted?: boolean;
}) {
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);
  const onChange = useCallback(
    (next: SetupSnapshotData) => setValues(applyDerivedFieldsToSnapshot(next)),
    []
  );

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
  // Tells a HOST with its own exits the same thing, plus a way to save from one of them.
  useReportHostedSave(save, onSaveStateChange);

  return (
    <div className="space-y-3">
      <SetupSheetView
        value={values}
        template={template}
        enableFieldSearch
        // Every field commits on blur whether or not it was typed in, so a stray tap lands here
        // with the values unchanged. The bar compares, so that is a no-op rather than "unsaved".
        //
        // Through the derivation on the way in, so the rows the sheet works out for itself follow
        // the rows they are worked out from — spring rate from the gap, final drive from spur and
        // pinion. Every other structured editor in the app (the three import review screens, the
        // log-run form) has always done this; this one was the exception, so a correction made
        // here SAVED a spring rate that its own spring gap disagreed with.
        onChange={onChange}
      />
      {/* Last, not first: the bar rides the bottom of the screen, and `position: sticky` with a
          `bottom` offset only holds an element that sits at the END of its container. */}
      <SetupEditorSaveBar save={save} hosted={hosted} />
    </div>
  );
}
