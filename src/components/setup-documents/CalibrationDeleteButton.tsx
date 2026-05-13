"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type Props = {
  calibrationId: string;
  calibrationName: string;
  /** After successful delete, navigate here (default: setup calibrations list). */
  redirectTo?: string;
  className?: string;
};

export function CalibrationDeleteButton(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    const ok = window.confirm(
      `Delete calibration "${props.calibrationName}"? This cannot be undone. ` +
        `Setup documents and runs that used this profile will no longer be linked to it.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/setup-calibrations/${props.calibrationId}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(data.error?.trim() || `Delete failed (${res.status})`);
        return;
      }
      router.push(props.redirectTo ?? "/setup-calibrations");
      router.refresh();
    } catch {
      window.alert("Delete failed");
    } finally {
      setBusy(false);
    }
  }, [props.calibrationId, props.calibrationName, props.redirectTo, router]);

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
