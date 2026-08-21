"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingCorrection } from "@/components/runs/SetupCorrectionSheet";
import {
  takePendingSetupCascade,
  type PendingSetupCascadeItem,
} from "@/lib/setup/pendingSetupCascade";
import { correctionHasSomethingToOffer } from "@/lib/runs/setupCorrectionCascade";

/**
 * The state behind correcting a logged run in place.
 *
 * Kept out of `RunDetailPanel` because that component is shared by Sessions and
 * `/runs/[id]` and is already the biggest thing in the folder — the panel should
 * read as "here is what a run looks like", not as a form controller.
 *
 * Everything here is owner-only at the call site (`allowRunMutations`); the
 * routes enforce it again, so this is the affordance, not the guard.
 */

type ToastState = { message: string; undo?: () => void } | null;

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "That didn’t save");
  }
  return payload;
}

/** Same PATCH, but hands the answer back — the tire cascade reports through it. */
async function patchJsonWithBody(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "That didn’t save");
  }
  return payload;
}

async function patchJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "That didn’t save");
  }
}

/**
 * The questions worth asking, in order, each knowing its place in the queue.
 *
 * A correction is dropped when it has nothing to travel to — see
 * `correctionHasSomethingToOffer`. Note that is NOT "something is ticked": earlier runs are
 * never ticked by design, so testing for a tick would silently discard every
 * backward-only correction, which is exactly the case the backward walk was built for.
 *
 * The numbering counts the questions that SURVIVE, not the boxes that changed — "1 of 3"
 * on a queue that turns out to hold one is a promise of two more that never arrive.
 */
function toCorrectionQueue(
  runId: string,
  items: readonly PendingSetupCascadeItem[]
): PendingCorrection[] {
  const worth = items.filter((c) => correctionHasSomethingToOffer(c.candidates));
  return worth.map((c, i) => ({
    runId,
    field: c.field,
    previousDisplay: c.previousDisplay,
    nextDisplay: c.nextDisplay,
    candidates: c.candidates,
    queueIndex: i + 1,
    queueTotal: worth.length,
  }));
}


export function useRunCorrections({
  runId,
  onChanged,
}: {
  runId: string;
  /** Pull the run again — the server owns the truth once a write lands. */
  onChanged: () => void;
}) {
  /**
   * The questions this save earned, asked one at a time.
   *
   * A queue rather than a single correction since 2026-08-21: one save may fix up to
   * `MAX_CASCADE_QUESTIONS` boxes, and each has its own neighbours to ask about. Answering
   * or dismissing one shifts to the next, so the sheet never closes on an unasked question.
   */
  const [queue, setQueue] = useState<PendingCorrection[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const pending = queue[0] ?? null;
  const shiftQueue = useCallback(() => setQueue((q) => q.slice(1)), []);

  /**
   * Pick up the cascade questions the setup sheet left behind, if it left any.
   *
   * This replaced a `saveSetupValue` that PATCHed one key and opened the question from
   * the answer. It went when the inline setup boxes did (2026-08-20): setup is corrected
   * on the sheet now, so a correction made from the GARAGE happens on another page.
   *
   * The correction itself already happened; this only asks whether it should travel.
   * Read-once (see `takePendingSetupCascade`), so a driver who came back to the run by
   * some other route never meets a question about an edit they finished with.
   *
   * A correction made in the run's own setup pop-up never travels through here — it comes
   * straight across via `offerCorrections`.
   */
  useEffect(() => {
    const stashed = takePendingSetupCascade(runId);
    if (!stashed) return;
    setQueue(toCorrectionQueue(runId, stashed.corrections));
  }, [runId]);

  /**
   * Ask about corrections that happened right here, with no page in between.
   *
   * `suppressedKeyCount` is the save the route declined to ask about because it moved too
   * many boxes. It is reported rather than swallowed: silence is what made this read as a
   * feature that had been removed (founder, 2026-08-21).
   */
  const offerCorrections = useCallback(
    (items: PendingSetupCascadeItem[], suppressedKeyCount = 0) => {
      const next = toCorrectionQueue(runId, items);
      if (next.length > 0) {
        setQueue(next);
        return;
      }
      if (suppressedKeyCount > 0) {
        setToast({
          message: `${suppressedKeyCount} values changed — too many to offer to your other runs.`,
        });
      }
    },
    [runId]
  );

  /** The additive, chosen from the catalog. Also re-stamped onto the sheet server-side. */
  const saveAdditive = useCallback(
    async (additiveTypeId: string | null) => {
      await patchJson(`/api/runs/${encodeURIComponent(runId)}`, { additiveTypeId });
      onChanged();
    },
    [runId, onChanged]
  );

  /**
   * Everything else on the run that is the driver's own answer — the session label, the
   * event, the car, the tire set and its run number, prep, notes, the rating, the
   * handling assessment. One sparse PATCH each, because that is what the route is:
   * a fix should not have to round-trip every other field to change one thing.
   */
  const saveFields = useCallback(
    async (patch: Record<string, unknown>) => {
      const payload = await patchJsonWithBody(`/api/runs/${encodeURIComponent(runId)}`, patch);
      onChanged();
      /*
       * A tire run-number correction shifts every later run on the same set, and the
       * driver is looking at ONE run — so without this the other rows move silently.
       * Reported, not offered: unlike a setup value, the shift is arithmetic on a set
       * the driver has just re-described, not a guess about what they meant.
       */
      const cascade = payload.tireRunNumberCascade as { updatedRuns: number } | null | undefined;
      if (cascade && cascade.updatedRuns > 0) {
        setToast({
          message: `Also moved ${cascade.updatedRuns} later ${
            cascade.updatedRuns === 1 ? "run" : "runs"
          } on this set.`,
        });
      }
    },
    [runId, onChanged]
  );

  /**
   * Take the timing import off this run. The laps go, and so does everything derived
   * from them — see the route. Never offered without the source being named first: a
   * button that removes laps whose origin the page never showed is a trap.
   */
  const detachLapImport = useCallback(async () => {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/lap-import`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Could not remove those laps");
    }
    onChanged();
    setToast({ message: "Laps removed from this run." });
  }, [runId, onChanged]);

  const applyCorrection = useCallback(
    async (runIds: string[]) => {
      const current = pending;
      if (!current) return;
      const revertTo = current.previousDisplay === "—" ? "" : current.previousDisplay;

      const payload = await postJson(
        `/api/runs/${encodeURIComponent(runId)}/setup-correction/apply`,
        { key: current.field.key, value: current.nextDisplay, runIds }
      );
      const updated = (payload.updatedRunIds as string[] | undefined) ?? [];
      shiftQueue();
      onChanged();

      // "other", not "later" — the ticked runs can now sit either side of the correction.
      setToast({
        message:
          updated.length === 0
            ? "Those runs already said that — nothing to change."
            : `${current.field.label} fixed on ${updated.length} other ${updated.length === 1 ? "run" : "runs"}.`,
        undo:
          updated.length === 0
            ? undefined
            : () => {
                /*
                 * Undo puts the OTHER runs back, not this one. The driver corrected
                 * this run on purpose and then answered a question about the others;
                 * undoing the answer should not also undo the thing that prompted it.
                 */
                void postJson(`/api/runs/${encodeURIComponent(runId)}/setup-correction/apply`, {
                  key: current.field.key,
                  value: revertTo,
                  runIds: updated,
                })
                  .then(() => {
                    onChanged();
                    setToast({ message: "Those runs put back." });
                  })
                  .catch(() => setToast({ message: "Could not undo that." }));
              },
      });
    },
    [pending, runId, onChanged, shiftQueue]
  );

  return {
    saveAdditive,
    saveFields,
    detachLapImport,
    offerCorrections,
    pendingCorrection: pending,
    // "Just this run" answers THIS question and moves to the next, rather than
    // abandoning every question the save earned.
    dismissCorrection: shiftQueue,
    applyCorrection,
    toast,
    dismissToast: useCallback(() => setToast(null), []),
  };
}
