"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupFillDraftSubject } from "@/lib/setup/setupFillDraft";

/**
 * Client half of the sequential-fill draft: the two network calls, and nothing else.
 *
 * Lives here rather than in either parent because the driver flow (keyed by car) and the admin
 * baseline flow (keyed by chassis model) differ only in which id goes in the body. Everything
 * about debouncing, resume and error surfacing lives in `SetupFillFlow`; everything about the
 * fetch lives here, so neither parent duplicates a line of it.
 */

export type SetupFillDraftSnapshot = {
  values: SetupSnapshotData;
  stepIndex: number;
  pendingText: string | null;
  pendingStepKey: string | null;
  answeredCount: number;
  stepCount: number;
};

export type SetupFillDraftBinding = {
  /** Persist. Rejecting flips the flow's pill to "Not saved"; it must never block filling. */
  save: (snapshot: SetupFillDraftSnapshot) => Promise<void>;
  /** Throw the draft away — "Discard" in the exit prompt, "Start over" on the resume card. */
  discard: () => Promise<void>;
};

async function jsonFetch(input: RequestInfo, init?: RequestInit): Promise<void> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${res.status})`);
  }
}

/**
 * Pass `null` to disable drafts entirely — the hook returns undefined and `SetupFillFlow` falls
 * back to its original in-memory behaviour with no branching at the call site.
 */
export function useSetupFillDraft(
  subject: SetupFillDraftSubject | null,
  meta?: { name?: string | null; templateId?: string | null }
): SetupFillDraftBinding | undefined {
  // Mirrored through refs so the returned callbacks stay referentially stable: they land in the
  // fill flow's debounce deps, and a new identity on every parent keystroke (the setup name field
  // is right there) would re-arm the timer forever and never actually save.
  //
  // Synced in an effect rather than during render. The initial values are already correct from
  // `useRef`, and nothing can call `save`/`discard` before the first effect runs — they only fire
  // from a debounce timer or a tap.
  const subjectRef = useRef(subject);
  const metaRef = useRef(meta);
  useEffect(() => {
    subjectRef.current = subject;
    metaRef.current = meta;
  }, [subject, meta]);

  const save = useCallback(async (snapshot: SetupFillDraftSnapshot) => {
    const subj = subjectRef.current;
    if (!subj) return;
    await jsonFetch("/api/setup-fill-drafts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Survives the page being backgrounded mid-flight, which is the failure this whole
      // feature exists for — the visibilitychange flush depends on it.
      keepalive: true,
      body: JSON.stringify({
        ...subj,
        data: snapshot.values,
        stepIndex: snapshot.stepIndex,
        pendingText: snapshot.pendingText,
        pendingStepKey: snapshot.pendingStepKey,
        answeredCount: snapshot.answeredCount,
        stepCount: snapshot.stepCount,
        name: metaRef.current?.name ?? null,
        templateId: metaRef.current?.templateId ?? null,
      }),
    });
  }, []);

  const discard = useCallback(async () => {
    const subj = subjectRef.current;
    if (!subj) return;
    const query = new URLSearchParams(subj as Record<string, string>).toString();
    await jsonFetch(`/api/setup-fill-drafts?${query}`, { method: "DELETE" });
  }, []);

  // Only *whether* there is a subject matters for the binding's identity; which subject it is gets
  // read through the ref at call time.
  const enabled = Boolean(subject);
  return useMemo(
    () => (enabled ? { save, discard } : undefined),
    [enabled, save, discard]
  );
}
