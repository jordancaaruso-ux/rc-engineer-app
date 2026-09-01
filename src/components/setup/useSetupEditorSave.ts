"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renameSetup } from "@/lib/setup/keepSetupClient";
import { changedSetupKeys } from "@/lib/setup/setupValuesFingerprint";
import type { SetupSaveMode } from "@/lib/setup/setupSaveMode";
import {
  stashPendingSetupCascade,
  type PendingSetupCascadeItem,
} from "@/lib/setup/pendingSetupCascade";
import type { CorrectionCandidate } from "@/components/runs/SetupCorrectionSheet";

/** The cascade sheet shows values as text; `—` is what it prints for "nothing recorded". */
function displayForCascade(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

type CorrectionFromRoute = {
  key: string;
  label: string;
  previousValue: unknown;
  value: unknown;
  candidates: CorrectionCandidate[];
};

type SetupCorrectionResponse = {
  snapshot: { id: string };
  /** The first question, kept so an un-refreshed client still works. */
  correction?: CorrectionFromRoute | null;
  /** Every question this save earned — one per corrected value. */
  corrections?: CorrectionFromRoute[] | null;
  /** Non-zero when the save moved too many boxes to offer anything. */
  suppressedKeyCount?: number | null;
};

/**
 * The route's questions in the shape the run page asks them in.
 *
 * Falls back to the single `correction` field, because this hook and the route deploy
 * separately: a stale service worker serving yesterday's bundle against today's route (or
 * the reverse) is an ordinary Tuesday for an installed PWA, and the failure mode without
 * this is the feature silently doing nothing.
 */
function correctionItems(body: SetupCorrectionResponse): PendingSetupCascadeItem[] {
  const raw = body.corrections ?? (body.correction ? [body.correction] : []);
  return raw
    .filter((c) => c && c.candidates.length > 0)
    .map((c) => ({
      field: { key: c.key, label: c.label },
      previousDisplay: displayForCascade(c.previousValue),
      nextDisplay: displayForCascade(c.value),
      candidates: c.candidates,
    }));
}

function suppressedCount(body: SetupCorrectionResponse): number {
  return typeof body.suppressedKeyCount === "number" ? body.suppressedKeyCount : 0;
}

/** What a caller hosting the editor in place is handed instead of a navigation. */
export type SetupEditorSavedResult = {
  snapshotId: string;
  corrections: PendingSetupCascadeItem[];
  /** How many boxes moved, when that was too many to ask about. Zero otherwise. */
  suppressed: number;
};

/**
 * The save behaviour both setup editors share — the grid one and the sheet one. They differ only in
 * how a value gets from the screen into storage; what a save *means* is identical, and used to be
 * copy-pasted between them.
 *
 * ============================== NOTHING SAVES ITSELF ==============================
 *
 * Every door here is a press (founder call, 2026-08-16). The debounced write-as-you-type that used
 * to run on the driver's own named setups is gone: it was the one place in the app where typing
 * changed a thing already on the shelf, and a setup is not a text box. `dirty` is exported so the
 * bar can say so, and it arms a `beforeunload` prompt — closing the tab mid-edit now asks.
 *
 * ============================== DIRTY IS A COMPARISON, NOT A FLAG ==============================
 *
 * It used to be a boolean armed by any call to the editor's `onChange`, mirrored out of a ref. That
 * said "unsaved changes" on a setup nobody had touched — see `setupValuesFingerprint`, which carries
 * the three ways it armed itself. Now the values as OPENED are held here and compared against the
 * values as they stand, which means:
 *
 * - opening a setup, or a re-render handing the same values back, can never read as work;
 * - putting a number back the way it was clears the bar and disarms the `beforeunload` prompt,
 *   because there is nothing left to lose;
 * - `changedCount` is free, so the bar can say how much is riding on the press.
 *
 * The baseline moves to what was written the moment a save lands, so the next edit counts from what
 * is now on the shelf rather than from what the driver first opened.
 *
 * Losing it also fixed a quieter wrong: "Save as a new setup" used to FLUSH the pending autosave
 * onto the setup being copied first, so forking a setup you had just edited wrote your changes into
 * BOTH rows. The edits belong to the copy alone.
 *
 * ============================== THE DOORS ==============================
 *
 * `saveMode` (see `setupSaveMode.ts`) names one primary and at most one secondary:
 *
 * - `inPlace`    — "Save changes" writes over the setup. Forking is the second door.
 * - `correctRun` — "Correct this run" is primary, because the driver came in from the run. The run
 *                  route writes a new snapshot and repoints the run, and we follow them to that new
 *                  row because the one they opened is no longer the run's.
 * - `fork`       — "Save as a new setup" is primary; correcting the run, when exactly one run is
 *                  named, is the quiet second door.
 *
 * A fork always records where it came from (`baseSetupSnapshotId`), so the new setup can say
 * "Edited from …" rather than appearing from nowhere.
 *
 * ============================== THE FORK ASKS FOR A NAME ==============================
 *
 * Founder call, 2026-08-17. This REVERSES the line that used to sit here — that a fork is named
 * without asking, on the authority of the 2026-08-11 ruling which took a `window.prompt` off the
 * All-setups bookmark. That ruling was right about the bookmark and wrong when it was carried
 * here: keeping a row that already has a title is a question with one right answer, while a fork
 * makes a thing with no title at all. Named for the driver, both copies of a twice-forked setup
 * came out "Mod A (edited)", a fork of a fork came out "Mod A (edited) (edited)", and a copy taken
 * off a session was offered "Round 2 at Kingston (edited)". The Rename link that was meant to
 * cover it is eleven grey pixels in the corner of the bar and is gone the moment they navigate.
 *
 * So the fork carries a `namePrompt` and the bar collects the name in a `SetupNameSheet` before
 * running it. The suggestion arrives selected, so accepting it is still one tap. Rename stays as it
 * was — it edits a name that exists, which is the job the 2026-08-11 ruling was actually about.
 */

/** What the bar has to collect before an action may run. Only the fork has one. */
export type SetupEditorNamePrompt = {
  title: string;
  /** One line under it — what the copy is, and what it leaves alone. */
  detail: string;
  /** Prefilled and pre-selected, so accepting it is one tap. */
  suggestedName: string;
  confirmLabel: string;
};

export type SetupEditorSaveAction = {
  label: string;
  /** Present-tense word shown while it runs, e.g. "Saving…". */
  busyLabel: string;
  /**
   * Resolves TRUE when the save landed. The name sheet uses it to decide whether to close: a failed
   * save has to leave the sheet up with the driver's typing still in it, or a 500 silently eats the
   * name they just chose.
   */
  run: (name?: string) => Promise<boolean>;
  /**
   * Stays filled yellow with nothing changed. Only the fork does: copying a setup exactly as it
   * stands is a real thing to want, while writing zero changes over a setup is not.
   */
  loudWhenClean?: boolean;
  /** Present when pressing this must ask a question first. See `SetupNameSheet`. */
  namePrompt?: SetupEditorNamePrompt;
};

/**
 * What the name sheet opens with. One `(edited)` suffix is stripped before another is added, so
 * forking a fork cannot stack them — the accumulation was half the reason this stopped being
 * automatic.
 */
export function suggestedForkName(sourceName?: string | null): string {
  const base = (sourceName ?? "").trim().replace(/\s*\(edited\)$/i, "") || "Setup";
  return `${base} (edited)`.slice(0, 80);
}

export type SetupEditorSave = {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
  /** A save is in flight; disable the buttons. */
  busy: boolean;
  /** The driver has changed something that is not yet stored. */
  dirty: boolean;
  /** How many boxes differ from the setup as it was opened. Zero whenever `dirty` is false. */
  changedCount: number;
  /**
   * Ticks once per landed save. Says nothing about the setup — it is a version to hang cached,
   * server-drawn artifacts off, so they are re-made after an edit rather than served from before
   * it. See `setupEditorShare`.
   */
  savedCount: number;
  /** The loud button. Every mode has one. */
  primary: SetupEditorSaveAction;
  /** The quiet one beside it, when the mode has a second thing worth offering. */
  secondary: SetupEditorSaveAction | null;
  /** Renames the setup being edited. Null while a name would mean nothing (nothing saved yet). */
  rename: (() => Promise<void>) | null;
  /** One line explaining the mode, when it isn't self-evident from the buttons. */
  note: string | null;
};

export function useSetupEditorSave({
  carId,
  setupId,
  setupName,
  saveMode,
  values,
  getData,
  returnHref,
  onSaved,
}: {
  carId: string;
  setupId: string;
  /** Names the copy when this setup is forked, and seeds Rename. */
  setupName?: string | null;
  saveMode: SetupSaveMode;
  /**
   * The editor's values, in whatever shape it holds them — the grid's stored data, the sheet's
   * surface strings. Only ever compared against itself, so the shape is this hook's business only
   * as long as it is the SAME shape on both sides.
   */
  values: unknown;
  /** Reads the editor's current values in the shape storage wants. Changes with `values`. */
  getData: () => Record<string, unknown>;
  /**
   * Where a run correction lands, from `?back=` (see `lib/setup/setupEditorReturn`).
   *
   * Null keeps the old behaviour — following the run to its NEW snapshot's editor —
   * which is still right for a correction started from the garage, where there is
   * no run page to go back to.
   */
  returnHref?: string | null;
  /**
   * Set when the editor is hosted ON the run page rather than being a page of its own —
   * the setup pop-up (2026-08-21).
   *
   * It replaces BOTH halves of the hand-off: there is no navigation to make, because the
   * driver is already where they were going, and no `sessionStorage` hop to make, because
   * the cascade questions can be handed straight to the component that asks them. Absent,
   * everything behaves exactly as it did.
   */
  onSaved?: (result: SetupEditorSavedResult) => void;
}): SetupEditorSave {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * The setup as it was opened, and what everything on screen is measured against. State, not a ref:
   * a save moves it, and the bar has to repaint when it does.
   */
  const [baseline, setBaseline] = useState(values);
  /** See the note on `SetupEditorSave.savedCount`. */
  const [savedCount, setSavedCount] = useState(0);
  const changedCount = useMemo(() => changedSetupKeys(baseline, values).length, [baseline, values]);
  const dirty = changedCount > 0;

  /*
   * The browser's own "leave site?" prompt. It is the only guard that works on a tab close or a
   * reload; an in-app Back is a client-side navigation the browser never tells us about, so the
   * bar's own amber is what covers that case.
   */
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy field: Safari and older Chrome still need it set for the prompt to appear.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /**
   * A save landed. The values that went with it ARE the setup now, so the next edit counts from
   * them — passed in rather than read from a ref so it is the values of the render the press
   * started on, never whatever the driver typed while the request was in flight.
   */
  const settled = useCallback((written: unknown) => {
    setBaseline(written);
    setStatus("saved");
    setSavedCount((n) => n + 1);
  }, []);

  /*
   * "Saved" is a receipt, not a state to sit in. Left up, it becomes the bar's resting text and says
   * nothing about the setup on screen — the driver can edit for a minute under a word claiming
   * everything is stored. It goes back to a blank bar after a beat.
   */
  useEffect(() => {
    if (status !== "saved") return;
    const t = window.setTimeout(() => setStatus("idle"), 3000);
    return () => window.clearTimeout(t);
  }, [status]);

  /** Writes over the setup in the URL. Only ever reached in `inPlace`. */
  const saveOver = useCallback(async () => {
    setBusy(true);
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(`/api/setup-snapshots/${setupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: getData() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save.");
      }
      settled(values);
      router.refresh();
      return true;
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [setupId, getData, settled, values, router]);

  /**
   * Correct a run: a new snapshot, and that run alone repointed at it. Runs still on the old
   * snapshot keep it — this writes nothing over.
   */
  const correctRun = useCallback(
    async (runId: string) => {
      setBusy(true);
      setStatus("saving");
      setError(null);
      try {
        const res = await fetch(`/api/runs/${runId}/setup-snapshot`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setupData: getData() }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not update the run.");
        }
        const body = (await res.json()) as SetupCorrectionResponse;
        settled(values);

        /*
         * Hand the "did your other runs have this wrong too?" questions back to the run.
         *
         * They are about the corrected run's NEIGHBOURS, so they belong on the run page,
         * not here — and this editor is about to navigate there. The route returns one per
         * corrected value, up to `MAX_CASCADE_QUESTIONS`; past that it returns none and
         * says how many it declined, which the run page reports rather than swallows.
         *
         * `onSaved` short-circuits the whole hand-off: a caller that is ALREADY on the run
         * page (the setup pop-up) takes the questions in memory and never navigates, so
         * there is nothing to stash and nowhere to travel to.
         */
        const items = correctionItems(body);
        if (onSaved) {
          onSaved({ snapshotId: body.snapshot.id, corrections: items, suppressed: suppressedCount(body) });
          return true;
        }
        stashPendingSetupCascade({ runId, corrections: items });
        /*
         * Back to where the driver came from, when they said.
         *
         * The run points at a new snapshot now, and the one still in the URL is no
         * longer its record — which used to be the whole argument for pushing them
         * to the NEW snapshot's editor. It was the wrong conclusion: a driver who
         * came in from a run, corrected it, and pressed the primary button ended up
         * on a second copy of the editor holding a setup id they had never seen,
         * with nothing pointing back at the run they were reading (founder call,
         * 2026-08-20). The stale URL is a reason to LEAVE, not a reason to open
         * another editor.
         *
         * Without `?back=` the old behaviour stands: reached from the garage there
         * is no run page to return to, and the new row is the honest destination.
         */
        router.push(
          returnHref ??
            `/cars/${carId}/setups/${body.snapshot.id}/edit?run=${encodeURIComponent(runId)}`
        );
        router.refresh();
        return true;
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not update the run.");
        setBusy(false);
        return false;
      }
    },
    [carId, router, getData, settled, values, returnHref, onSaved]
  );

  /**
   * "Keep this as its own setup" — how a baseline for the next meeting gets made, and the primary
   * door out of a run's setup opened from the garage.
   *
   * The values travel with the request: `fromSetupSnapshotId` would re-read the SOURCE row on the
   * server and quietly throw this edit away. `baseSetupSnapshotId` is the provenance, and is what
   * lets the new setup say what it was edited from.
   */
  const saveAsNew = useCallback(
    async (name?: string) => {
      setBusy(true);
      setStatus("saving");
      setError(null);
      try {
        const res = await fetch("/api/setup-snapshots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            carId,
            // The sheet always sends one; the fallback only covers a caller that skipped it.
            name: name?.trim() || suggestedForkName(setupName),
            data: getData(),
            baseSetupSnapshotId: setupId,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not create the new setup.");
        }
        const body = (await res.json()) as { setup: { id: string } };
        settled(values);
        // No `?run=`: the copy is nobody's record, and further edits should land on it in place.
        router.push(`/cars/${carId}/setups/${body.setup.id}/edit`);
        /*
         * The car page has a new row on it, and this is what says so.
         *
         * Without it the fork was the ONE door here that never invalidated anything — `saveOver`
         * and `correctRun` both refresh — and `experimental.staleTimes.dynamic` (30s, next.config)
         * hands back any page visited inside that window without re-fetching it. So backing out to
         * the car page served the copy from BEFORE the save, and the new setup appeared only after
         * a hard reload threw the router cache away. Founder-reported, 2026-08-17.
         */
        router.refresh();
        return true;
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not create the new setup.");
        setBusy(false);
        return false;
      }
    },
    [carId, setupId, setupName, router, getData, settled, values]
  );

  /**
   * Renaming is allowed on any setup of the driver's, including a run's own record — only a run
   * snapshot's VALUES are frozen, never its label. This is where the name lands after a fork saved
   * without asking for one.
   */
  const rename = useCallback(async () => {
    const entered = window.prompt("Setup name", setupName ?? "");
    if (entered == null) return;
    const name = entered.trim();
    if (!name || name === setupName) return;
    setBusy(true);
    setError(null);
    try {
      await renameSetup(setupId, name);
      router.refresh();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not rename this setup.");
    } finally {
      setBusy(false);
    }
  }, [setupId, setupName, router]);

  /*
   * What the copy leaves alone, said in the sheet rather than left to be inferred. It is different
   * per door — off a run the reassurance the driver needs is "the session keeps its record", and
   * off a saved setup it is "the one you opened is untouched".
   *
   * The run case does NOT name the source. A run snapshot's label IS the session ("Testing run",
   * "R2 at Kingston"), and dropping it in read "The run keeps Testing run as it raced" — measured
   * on screen, 2026-08-17.
   */
  const sourceLabel = setupName?.trim() || "this setup";
  const forkAction: SetupEditorSaveAction = {
    label: "Save as new setup",
    busyLabel: "Saving…",
    run: saveAsNew,
    // A copy of a teammate's setup, taken exactly as it stands, is the reason this door exists.
    loudWhenClean: true,
    namePrompt: {
      title: "Name this setup",
      detail:
        saveMode.kind === "inPlace"
          ? `A copy with your changes. ${sourceLabel} stays as it is.`
          : "A copy with your changes. The run keeps its own record.",
      suggestedName: suggestedForkName(setupName),
      confirmLabel: "Save setup",
    },
  };

  let primary: SetupEditorSaveAction;
  let secondary: SetupEditorSaveAction | null;
  let note: string | null = null;

  if (saveMode.kind === "inPlace") {
    primary = { label: "Save changes", busyLabel: "Saving…", run: saveOver };
    secondary = forkAction;
  } else if (saveMode.kind === "correctRun") {
    const runId = saveMode.runId;
    primary = {
      label: "Correct this run",
      busyLabel: "Correcting…",
      run: () => correctRun(runId),
    };
    secondary = forkAction;
    note = "You opened this from the run, so saving changes what that run says it raced.";
  } else {
    primary = forkAction;
    const runId = saveMode.correctableRunId;
    secondary = runId
      ? { label: "Correct this run", busyLabel: "Correcting…", run: () => correctRun(runId) }
      : null;
    note =
      saveMode.runCount === 1
        ? "Saving keeps the run as it was and puts your changes in a setup of their own."
        : `${saveMode.runCount} runs were logged on these numbers, so they stay as they are. Open a run if you need to correct that one.`;
  }

  return {
    status,
    error,
    busy,
    dirty,
    changedCount,
    savedCount,
    primary,
    secondary,
    rename,
    note,
  };
}

/**
 * ============================== TELLING A HOST WHAT IS UNSAVED ==============================
 *
 * The save bar is not always the only way out. The run's setup pop-up hosts an editor inside a
 * dialog that has three exits of its own — Cancel, Close, and the scrim — and none of them press
 * a button in the bar. `beforeunload` cannot cover any of them: nothing unloads, a React subtree
 * simply stops being rendered, and the driver's typing goes with it.
 *
 * So an editor publishes where it stands, and the host asks before it takes one of its own exits.
 * `save` is the mode's PRIMARY door and nothing else — the fork opens a name sheet the host has no
 * business drawing, and "Correct this run" is the answer the driver came in for.
 */
export type HostedSetupSave = {
  dirty: boolean;
  /** How many boxes differ from the setup as it was opened. Zero whenever `dirty` is false. */
  changedCount: number;
  busy: boolean;
  /** The last save's message, when it failed. Null otherwise. */
  error: string | null;
  /** What the primary door calls itself, so a host asks in the editor's own words. */
  saveLabel: string;
  /** Runs the primary door. Resolves true when the save landed. */
  save: () => Promise<boolean>;
};

/**
 * Publish an editor's state to a host that has exits of its own. Null on unmount — leaving edit
 * mode takes the editor with it, and a host still believing in unsaved work would ask about
 * changes that no longer exist.
 */
export function useReportHostedSave(
  save: SetupEditorSave,
  onChange?: (state: HostedSetupSave | null) => void
): void {
  /*
   * Two latest-refs, both to keep this from demanding stability of its caller. `save.primary` is
   * rebuilt on every render of the editor, so publishing it directly would hand the host a new
   * function each time and re-render it forever; and a host that passed an inline `onChange` would
   * otherwise re-fire the publish effect on every one of ITS renders.
   */
  const runRef = useRef(save.primary.run);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    runRef.current = save.primary.run;
    onChangeRef.current = onChange;
  });

  const runPrimary = useCallback(() => runRef.current(), []);

  const { dirty, changedCount, busy, status, error } = save;
  const saveLabel = save.primary.label;
  useEffect(() => {
    onChangeRef.current?.({
      dirty,
      changedCount,
      busy,
      error: status === "error" ? error : null,
      saveLabel,
      save: runPrimary,
    });
  }, [dirty, changedCount, busy, status, error, saveLabel, runPrimary]);

  useEffect(() => () => onChangeRef.current?.(null), []);
}
