"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SetupFillFlow } from "@/components/setup/SetupFillFlow";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/** Admin kit-setup entry — the driver fill flow, saving to `SetupSheetModel.kitSetupJson`. */
export function KitSetupEditorClient({
  modelId,
  modelName,
  template,
  initialValues,
  hasExisting,
}: {
  modelId: string;
  modelName: string;
  template: SetupSheetTemplate;
  initialValues: SetupSnapshotData;
  hasExisting: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (values: SetupSnapshotData) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/setup-sheet-models/${modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kitSetup: values }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save the kit setup.");
      }
      router.push(`/setup-sheet-models/${modelId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the kit setup.");
      setSaving(false);
    }
  };

  return (
    <SetupFillFlow
      template={template}
      initialValues={initialValues}
      subject={modelName}
      saveLabel={hasExisting ? "Update kit setup" : "Save kit setup"}
      saving={saving}
      error={error}
      onSave={(values) => void save(values)}
      onCancel={() => router.push(`/setup-sheet-models/${modelId}`)}
    />
  );
}
