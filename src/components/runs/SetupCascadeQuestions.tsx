"use client";

import { useEffect } from "react";
import { ActionToast } from "@/components/ui/ActionToast";
import { SetupCorrectionSheet } from "@/components/runs/SetupCorrectionSheet";
import { useRunCorrections } from "@/components/runs/useRunCorrections";
import type { SetupEditorSavedResult } from "@/components/setup/useSetupEditorSave";

/**
 * "Did your other runs have this wrong too?", for a host that is NOT a run panel.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * The setup pop-up hands its cascade questions back to whoever opened it, through
 * `SetupSheetModal`'s `onRunSetupCorrected`. Something then has to ASK them, and until
 * 2026-08-25 the only thing that could was `RunDetailPanel` — it owns a `useRunCorrections`
 * for the inline pickers anyway, so the sheet came free.
 *
 * Then the wrench became editable on four more surfaces (the flat sessions table, the
 * Sessions gutter, the trend card) and the folded run view replaced the run page on
 * Analysis and the Sessions day. Every one of them passed a callback that refreshed the
 * page and dropped the questions on the floor — so a driver correcting a run anywhere
 * except `/runs/[id]` was never offered their other runs at all, which is a feature that
 * had shipped reading as one that had been removed (founder-reported, 2026-08-25).
 *
 * A host that already runs the hook (`RunDetailPanel`, `RunFaces`) calls `offerCorrections`
 * itself and does not need this. This is for hosts that own nothing but a modal.
 *
 * ============================== THE NONCE ==============================
 *
 * The payload for two identical corrections is deep-equal, so a host watching the result
 * itself would swallow the second — and the second is exactly the one a driver makes after
 * answering "just this run" the first time. The host bumps a nonce per hand-off; that, and
 * nothing else, is the signal.
 *
 * Mount it with `key={runId}` if the host can point it at a different run without
 * unmounting: the queue belongs to the run it was raised for.
 */
export function SetupCascadeQuestions({
  runId,
  displayTimeZone,
  pending,
  onChanged,
}: {
  runId: string;
  displayTimeZone?: string | null;
  /** What the pop-up handed back, plus a nonce that makes a repeat hand-off count. */
  pending: { nonce: number; result: SetupEditorSavedResult } | null;
  /** Pull the run again — a cascade writes to runs other than the one on screen. */
  onChanged: () => void;
}) {
  const corrections = useRunCorrections({ runId, onChanged });

  const nonce = pending?.nonce ?? null;
  useEffect(() => {
    if (nonce == null || !pending) return;
    corrections.offerCorrections(pending.result.corrections, pending.result.suppressed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the nonce IS the signal; see above.
  }, [nonce]);

  return (
    <>
      <SetupCorrectionSheet
        correction={corrections.pendingCorrection}
        displayTimeZone={displayTimeZone}
        onClose={corrections.dismissCorrection}
        onApply={corrections.applyCorrection}
      />
      <ActionToast
        message={corrections.toast?.message ?? null}
        action={corrections.toast?.undo ? { label: "Undo", onClick: corrections.toast.undo } : null}
        onDismiss={corrections.dismissToast}
      />
    </>
  );
}
