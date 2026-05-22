"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SetupSheetModelSchemaEditor } from "@/components/setup-sheet-models/SetupSheetModelSchemaEditor";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

export function SetupSheetModelSchemaPageClient(props: {
  modelId: string;
  modelName: string;
  initialSchema: SetupSheetModelSchema;
  returnTo?: string | null;
}) {
  const router = useRouter();
  const returnTo = props.returnTo?.trim() || null;
  const [schema, setSchema] = useState(props.initialSchema);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/setup-sheet-models/${props.modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Save failed");
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
      {returnTo ? (
        <div className="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-xs">
          <Link href={returnTo} className="font-medium text-sky-200 hover:text-sky-100">
            ← Back to calibration
          </Link>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Add parameters here, save, then return to continue mapping PDF controls.
          </p>
        </div>
      ) : null}
      <SetupSheetModelSchemaEditor schema={schema} onChange={setSchema} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-sky-500/60 bg-sky-500/15 px-4 py-2 text-sm font-medium disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save parameters"}
        </button>
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
