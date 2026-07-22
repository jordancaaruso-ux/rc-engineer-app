"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/**
 * Grid editor for a saved library setup, with debounced autosave.
 *
 * Uses the existing `SetupSheetView` unchanged — a library setup and a run setup are the same
 * shape, so they get the same sheet.
 */

const SAVE_DEBOUNCE_MS = 800;

export function LibrarySetupEditorClient({
  setupId,
  initialValues,
  template,
}: {
  setupId: string;
  initialValues: SetupSnapshotData;
  template: SetupSheetTemplate;
}) {
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // Skip the save that the initial render would otherwise trigger.
  const dirty = useRef(false);

  const save = useCallback(
    async (next: SetupSnapshotData) => {
      setStatus("saving");
      setError(null);
      try {
        const res = await fetch(`/api/setup-snapshots/${setupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not save.");
        }
        setStatus("saved");
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    },
    [setupId]
  );

  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => void save(values), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [values, save]);

  return (
    <div className="space-y-3">
      <div className="flex h-5 items-center justify-end">
        {status === "saving" ? (
          <span className="ui-caption text-muted-foreground">Saving…</span>
        ) : status === "saved" ? (
          <span className="ui-caption text-muted-foreground">Saved</span>
        ) : status === "error" ? (
          <span className="ui-caption text-destructive">{error}</span>
        ) : null}
      </div>
      <SetupSheetView
        value={values}
        template={template}
        enableFieldSearch
        onChange={(next) => {
          dirty.current = true;
          setValues(next);
        }}
      />
    </div>
  );
}
