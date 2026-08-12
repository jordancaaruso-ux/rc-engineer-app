"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SetupSheetModelEditor } from "@/components/setup-sheet-models/SetupSheetModelEditor";
import {
  autoPlaceOnArrival,
  normalizeGroupsForEditing,
  resequenceSortOrderFromLayout,
} from "@/lib/setupSheetModels/layoutCanvasOps";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

export function SetupSheetModelSchemaPageClient(props: {
  modelId: string;
  modelName: string;
  initialSchema: SetupSheetModelSchema;
  returnTo?: string | null;
  /** False when the model is shared/curated and this user may only view it. */
  canEdit?: boolean;
  /** Admins get the canonical-parameter picker; for everyone else it is inferred and hidden. */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const returnTo = props.returnTo?.trim() || null;
  const canEdit = props.canEdit !== false;
  // Rewrite persisted legacy pair/corner4 group records into slots so the canvas deals with one
  // shape. Display-only — parse/save are untouched, so existing schemaJson blobs load unchanged.
  //
  // Then place everything if the canvas is blank — arriving from a box-first calibration, every
  // parameter is in the tray and the sheet is empty. Nothing is persisted until Save, and the
  // pre-placement schema is kept so it can be undone in one tap.
  const [arrival] = useState(() => {
    const normalized = normalizeGroupsForEditing(props.initialSchema);
    if (props.canEdit === false) return { schema: normalized, placedCount: 0, before: normalized };
    const placed = autoPlaceOnArrival(normalized);
    return { schema: placed.schema, placedCount: placed.placedCount, before: normalized };
  });
  const [schema, setSchema] = useState(arrival.schema);
  const [autoPlacedCount, setAutoPlacedCount] = useState(arrival.placedCount);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      // The canvas is the single source of order: renumber sortOrder from it so Log run and
      // Analysis follow the same arrangement the sheet shows, not the order boxes were mapped in.
      const toSave = resequenceSortOrderFromLayout(schema);
      setSchema(toSave);
      setAutoPlacedCount(0);
      const res = await fetch(`/api/setup-sheet-models/${props.modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: toSave }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        model?: { schema?: SetupSheetModelSchema };
      };
      if (!res.ok) throw new Error(data.error || "Save failed");
      if (data.model?.schema) setSchema(normalizeGroupsForEditing(data.model.schema));
      setStatus("Saved.");
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {!canEdit ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          This chassis type is shared and curated, so its parameters are view-only here. Ask an
          admin to change its name or parameters.
        </div>
      ) : null}

      {autoPlacedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs">
          <span className="text-foreground">
            Put {autoPlacedCount} parameter{autoPlacedCount === 1 ? "" : "s"} on the sheet, grouping
            the Front/Rear and corner sets.
          </span>
          <span className="text-muted-foreground">Arrange them, then save.</span>
          <button
            type="button"
            className="ml-auto rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSchema(arrival.before);
              setAutoPlacedCount(0);
            }}
          >
            Undo — leave them in the tray
          </button>
        </div>
      ) : null}

      {returnTo ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
          <Link href={returnTo} className="font-medium text-primary-ink hover:underline">
            ← Back to calibration
          </Link>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Edit the sheet layout and parameters here, save, then return to continue mapping PDF controls.
          </p>
        </div>
      ) : null}

      <fieldset
        disabled={!canEdit}
        className={`min-w-0 space-y-4 border-0 p-0 m-0 ${canEdit ? "" : "pointer-events-none select-none"}`}
      >
        <SetupSheetModelEditor
          schema={schema}
          onChange={setSchema}
          isAdmin={props.isAdmin}
          readOnly={!canEdit}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Button onClick={save} disabled={saving} className="text-sm">
            {saving ? "Saving…" : "Save setup sheet"}
          </Button>
        ) : null}
        {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
        {returnTo ? (
          <Link
            href={returnTo}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Return to calibration
          </Link>
        ) : null}
      </div>
    </div>
  );
}
