"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type Props = {
  modelId: string;
  modelName: string;
  carCount: number;
  calibrationCount: number;
  documentCount: number;
  /** True for global catalog slugs (Awesomatix, Mugen MTC3, etc.). */
  isCatalogEntry?: boolean;
  className?: string;
};

export function SetupSheetModelDeleteButton(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    const parts = [
      `Delete chassis type "${props.modelName}"?`,
      "This cannot be undone.",
    ];
    if (props.isCatalogEntry) {
      parts.push(
        "This is a built-in global chassis type. It will be removed for everyone and will not be auto-restored."
      );
    }
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
    props.isCatalogEntry,
    props.modelId,
    props.modelName,
    router,
  ]);

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
