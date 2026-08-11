"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SheetFillSurface, type SheetFillPlan } from "@/components/setup/SheetFillSurface";
import {
  storedValuesToSurface,
  surfaceValuesToStored,
} from "@/lib/setupSheetModels/sheetSurfaceValues";
import type { SetupSnapshotData } from "@/lib/runSetup";

/**
 * Edit a saved library setup ON ITS SHEET — the calibrated-chassis counterpart of
 * `LibrarySetupEditorClient`, same endpoints, same debounced autosave, same "Save as new setup"
 * door. The chassis's fill surface decides which editor a driver gets; a setup must read and edit
 * on the same surface it was filled on, or values would appear to move between the two views.
 *
 * Values cross the same bridge as the fill flow (`sheetSurfaceValues`), so a PATCH from here
 * stores byte-compatible shapes with a form edit — the change list cannot tell them apart.
 */

const SAVE_DEBOUNCE_MS = 800;

export function SheetSetupEditorClient({
  carId,
  setupId,
  setupName,
  setupSheetModelId,
  initialValues,
}: {
  carId: string;
  setupId: string;
  /** Seeds the name prompt when copying this setup. */
  setupName?: string | null;
  setupSheetModelId: string;
  initialValues: SetupSnapshotData;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    storedValuesToSurface(initialValues)
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  // Skip the save that the initial render would otherwise trigger.
  const dirty = useRef(false);
  const planRef = useRef<SheetFillPlan | null>(null);

  const toStored = useCallback((surface: Record<string, string>): Record<string, unknown> => {
    const plan = planRef.current;
    // No plan yet means nothing has been drawn, so nothing can be dirty — but fail safe anyway.
    return plan ? surfaceValuesToStored(surface, plan.fields) : surface;
  }, []);

  const save = useCallback(
    async (next: Record<string, string>) => {
      setStatus("saving");
      setError(null);
      try {
        const res = await fetch(`/api/setup-snapshots/${setupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: toStored(next) }),
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
    [setupId, toStored]
  );

  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => void save(values), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [values, save]);

  /** Same flow as the grid editor: flush the pending autosave, then fork. */
  const saveAsNew = async () => {
    const raw = window.prompt("Name for the new setup", `${setupName ?? "Setup"} copy`);
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return;

    setForking(true);
    setError(null);
    try {
      if (dirty.current) await save(values);
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carId, name, data: toStored(values), baseSetupSnapshotId: setupId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not create the new setup.");
      }
      const body = (await res.json()) as { setup: { id: string } };
      router.push(`/cars/${carId}/setups/${body.setup.id}/edit`);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not create the new setup.");
      setForking(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex h-8 items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void saveAsNew()}
          disabled={forking}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
        >
          {forking ? "Copying…" : "Save as new setup"}
        </button>
        {status === "saving" ? (
          <span className="ui-caption text-muted-foreground">Saving…</span>
        ) : status === "saved" ? (
          <span className="ui-caption text-muted-foreground">Saved</span>
        ) : status === "error" ? (
          <span className="ui-caption text-destructive">{error}</span>
        ) : null}
      </div>
      <SheetFillSurface
        planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan`}
        pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page`}
        initialValues={values}
        onChange={(next) => {
          dirty.current = true;
          setValues(next);
        }}
        onPlanLoaded={(p) => {
          planRef.current = p;
        }}
      />
    </div>
  );
}
