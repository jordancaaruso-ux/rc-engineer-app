"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SetupSheetModelSchemaEditor } from "@/components/setup-sheet-models/SetupSheetModelSchemaEditor";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

export function SetupSheetModelSchemaPageClient(props: {
  modelId: string;
  modelName: string;
  initialSchema: SetupSheetModelSchema;
}) {
  const router = useRouter();
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
      </div>
    </div>
  );
}
