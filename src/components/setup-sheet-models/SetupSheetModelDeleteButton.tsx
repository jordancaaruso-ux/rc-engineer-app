"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type Props = {
  modelId: string;
  modelName: string;
  carCount: number;
  calibrationCount: number;
  documentCount: number;
  protectedBuiltin?: boolean;
  className?: string;
};

export function SetupSheetModelDeleteButton(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    if (props.protectedBuiltin) {
      window.alert("The built-in Awesomatix A800 chassis type cannot be deleted.");
      return;
    }

    const parts = [
      `Delete chassis type "${props.modelName}"?`,
      "This cannot be undone.",
    ];
    if (props.carCount > 0) {
      parts.push(`${props.carCount} car(s) will be unlinked from this chassis type.`);
    }
    if (props.calibrationCount > 0) {
      parts.push(
        `${props.calibrationCount} calibration(s) will be unlinked (they are not deleted).`
      );
    }
    if (props.documentCount > 0) {
      parts.push(`${props.documentCount} setup document(s) will be unlinked.`);
    }

    const ok = window.confirm(parts.join("\n\n"));
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/setup-sheet-models/${props.modelId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(data.error?.trim() || `Delete failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      window.alert("Delete failed");
    } finally {
      setBusy(false);
    }
  }, [
    props.calibrationCount,
    props.carCount,
    props.documentCount,
    props.modelId,
    props.modelName,
    props.protectedBuiltin,
    router,
  ]);

  if (props.protectedBuiltin) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        props.className ??
        "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/15 disabled:opacity-50"
      }
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
