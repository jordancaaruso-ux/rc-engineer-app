"use client";

import { useMemo } from "react";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/**
 * Read-only setup sheet.
 *
 * Thin client wrapper so a server page can render `SetupSheetView` — the view owns a required
 * `onChange`, and functions can't cross the server/client boundary. Same sheet the editor and the
 * run detail use; nothing here re-implements field rendering.
 */
export function ReadOnlySetupSheet({
  value,
  template,
  changedKeys,
}: {
  value: SetupSnapshotData;
  template: SetupSheetTemplate;
  /** Keys that differed from the setup this one was based on (highlighted). */
  changedKeys?: string[];
}) {
  const highlight = useMemo(
    () => (changedKeys && changedKeys.length > 0 ? new Set(changedKeys) : null),
    [changedKeys]
  );

  return (
    <SetupSheetView
      value={value}
      onChange={() => {}}
      readOnly
      template={template}
      highlightChangedKeys={highlight}
    />
  );
}
