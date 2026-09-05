"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { ActionToast } from "@/components/ui/ActionToast";
import { setupFillDraftProgressLabel } from "@/lib/setup/setupFillDraft";
import { deleteSetup, keepSetup, renameSetup } from "@/lib/setup/keepSetupClient";
import {
  decideSetupRemoval,
  setupDeleteConfirmMessage,
  setupUsageLabel,
} from "@/lib/setup/setupRemoveMode";

/**
 * The car's setup library — named, reusable setups. Rows are hairline-separated inside one card
 * (the pattern every asset list uses).
 *
 * These are `SetupSnapshot.isLibrary` rows: they belong to the car, not to a run. Logging a run
 * picks one as its baseline and stores its own snapshot, so editing a library setup never rewrites
 * history.
 *
 * Rows open the grid editor directly (2026-07-29). They used to land on the read-only detail page,
 * which put a second "Edit" tap between a driver and the one value they came to change — testers
 * gave up and edited through Log Run instead, which writes a run snapshot, not the baseline.
 *
 * ONE EXCEPTION, since 2026-08-11: a setup kept from a run is that run's own record, so it opens
 * read-only. Saving from "All setups" marks the run's snapshot rather than copying it, and editing
 * the values afterwards would rewrite what that run says it ran.
 *
 * ============================== EVERY ROW HAS A WAY OUT ==============================
 *
 * Since 2026-09-03. The card used to show Delete only where `runs + derivedSnapshots === 0`, and
 * logging a run FROM a saved setup adds a derived snapshot — so the setups a driver actually raced
 * were the ones that could never leave the list, with nothing on screen saying why (founder report).
 * Worse, the API would have allowed most of them: only a run's own record is truly undeletable.
 *
 * So the row asks `decideSetupRemoval` — the same function the API asks — and offers whichever door
 * is real:
 *
 *  - **Delete** destroys the setup. Runs that started from it keep their own full values, which is
 *    why a raced setup is deletable at all; the confirm says so rather than making the driver guess.
 *  - **Remove** un-saves: the row leaves this list and the setup stays wherever it is still needed —
 *    a logged run's record, or the sheet an upload left behind. No confirm, because nothing is lost
 *    and the toast carries Undo; a dialog for a reversible act is the friction this card keeps
 *    removing.
 *
 * The count under the name splits along the same line: "3 runs" means three runs ARE this setup,
 * "3 runs from it" means three started here. Adding them together is what produced a row claiming
 * runs it never had.
 *
 * The create door is deliberately NOT in this header. It sits at the top of the car page, where the
 * Garage puts it, because making a setup and keeping a setup are different jobs (founder call
 * 2026-08-11: "they're not really related").
 */

/** `busyId` holds a snapshot id; the draft has none, so it borrows a value no id can be. */
const DRAFT_BUSY_ID = "fill-draft";

export type CarLibrarySetup = {
  id: string;
  name: string | null;
  createdAtLabel: string;
  /** Logged runs whose record IS this snapshot. These are why a setup can't be deleted. */
  runCount: number;
  /** Runs and setups that STARTED from this one. They hold their own values and block nothing. */
  derivedCount: number;
  /** Uploaded sheets that produced this setup. */
  sourceDocumentCount: number;
};

/** A sequential fill parked on this car. Progress is the client's last report — see the row below. */
export type CarSetupFillDraft = {
  answeredCount: number;
  stepCount: number;
  updatedAt: string;
};

export function CarSetupsCard({
  carId,
  setups,
  label = "Setups",
  fillDraft = null,
}: {
  carId: string;
  setups: CarLibrarySetup[];
  /** Section label — "Saved setups" when it sits beside sheets and run setups. */
  label?: string;
  /** An unfinished fill to point at. Null when there isn't one. */
  fillDraft?: CarSetupFillDraft | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Carries the row it removed, so Undo can put that exact setup back under its own name. */
  const [toast, setToast] = useState<{ message: string; setupId: string; name: string } | null>(
    null
  );

  /** The draft is not a setup, so it has no snapshot id to key `busyId` on. */
  const discardDraft = async () => {
    if (!window.confirm("Discard this draft? What you have filled so far is not kept.")) return;
    setBusyId(DRAFT_BUSY_ID);
    setError(null);
    try {
      const res = await fetch(
        `/api/setup-fill-drafts?${new URLSearchParams({ carId }).toString()}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not discard this draft.");
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not discard this draft.");
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (setup: CarLibrarySetup) => {
    const next = window.prompt("Setup name", setup.name ?? "");
    if (next == null) return;
    const name = next.trim();
    if (!name || name === setup.name) return;
    setBusyId(setup.id);
    setError(null);
    try {
      await renameSetup(setup.id, name);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename this setup.");
    } finally {
      setBusyId(null);
    }
  };

  const destroy = async (setup: CarLibrarySetup, derivedCount: number) => {
    const label = setup.name ?? "this setup";
    if (!window.confirm(setupDeleteConfirmMessage(label, derivedCount))) return;
    setBusyId(setup.id);
    setError(null);
    try {
      await deleteSetup(setup.id);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this setup.");
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Take the row off this list without touching the setup — the door for the two kinds that cannot
   * be deleted. Nothing is destroyed, so it asks nothing first and offers Undo afterwards instead.
   */
  const unsave = async (setup: CarLibrarySetup) => {
    const label = setup.name ?? "Untitled setup";
    setBusyId(setup.id);
    setError(null);
    try {
      await keepSetup({ setupId: setup.id, saved: false, name: label });
      setToast({ message: `Removed “${label}”.`, setupId: setup.id, name: label });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this setup.");
    } finally {
      setBusyId(null);
    }
  };

  const undoUnsave = async (undo: { setupId: string; name: string }) => {
    setToast(null);
    try {
      await keepSetup({ setupId: undo.setupId, saved: true, name: undo.name });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not put this setup back.");
    }
  };

  return (
    <CardPanel contentClassName="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        <span className="ui-caption">
          {setups.length > 0 ? `${setups.length} saved` : null}
        </span>
      </div>

      {/*
        A detour, not a list item — this isn't a saved setup, it's an unfinished action. It carries
        its own Discard because the only other way to be rid of it was to open the fill and start
        over, which is a strange errand: a driver who no longer wants the draft has to walk INTO it.
        Resume still hands off to that page, which is also the page that can recount progress
        against today's chassis schema (these counts are the client's last report and can drift by a
        field or two if that schema changed).
      */}
      {fillDraft ? (
        <div className="flex items-stretch gap-1 rounded-lg border border-amber-500/30 bg-amber-500/5 transition focus-within:border-amber-500/60 hover:border-amber-500/60">
          <Link
            href={`/cars/${carId}/setups/new`}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5"
          >
            <span className="min-w-0">
              <span className="block text-sm text-foreground">Draft in progress</span>
              <span className="block tabular-nums text-[11px] text-muted-foreground">
                {setupFillDraftProgressLabel(fillDraft.answeredCount, fillDraft.stepCount)} ·{" "}
                <RelativeTime iso={fillDraft.updatedAt} fallback="recently" />
              </span>
            </span>
            <span className="ui-caption shrink-0 text-warning">Resume →</span>
          </Link>
          <button
            type="button"
            onClick={discardDraft}
            disabled={busyId === DRAFT_BUSY_ID}
            aria-label="Discard this draft"
            className="shrink-0 px-3 text-muted-foreground transition hover:text-foreground disabled:opacity-60"
          >
            <span aria-hidden className="text-base leading-none">
              {busyId === DRAFT_BUSY_ID ? "…" : "×"}
            </span>
          </button>
        </div>
      ) : null}

      {setups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing saved yet. Save a setup from the list below and it lands here, ready to pick when
          you log a run.
        </p>
      ) : (
        <ul className="-mx-1">
          {setups.map((s) => {
            // Saved by definition — this list is `isLibrary: true` — so the decision turns purely on
            // what points at the row. The API asks the same question of the same numbers.
            const removal = decideSetupRemoval({
              isLibrary: true,
              runCount: s.runCount,
              derivedCount: s.derivedCount,
              sourceDocumentCount: s.sourceDocumentCount,
            });
            const usage = setupUsageLabel(s);
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 border-b border-border/60 px-1 py-2.5 last:border-0"
              >
                <Link
                  /*
                    Always the READ view. A never-run setup used to skip straight into the editor
                    ("only a setup nothing has run opens the editor") — which meant a setup imported
                    from a PDF landed on the fill surface with no Compare, no PDF, no share (founder,
                    2026-09-01, off his phone). Edit is one tap away on the page this opens.
                  */
                  href={`/cars/${carId}/setups/${s.id}`}
                  className="min-w-0 flex-1"
                >
                  <div className="truncate text-sm text-foreground">{s.name ?? "Untitled setup"}</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {s.createdAtLabel}
                    {usage ? ` · ${usage}` : ""}
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                    onClick={() => void rename(s)}
                    disabled={busyId === s.id || pending}
                  >
                    Rename
                  </button>
                  {/*
                    One of these, always — the row is never a dead end. Delete is destructive and
                    wears the destructive hover; Remove only takes the row off this list.
                  */}
                  {removal.kind === "delete" ? (
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-destructive disabled:opacity-50"
                      onClick={() => void destroy(s, removal.derivedCount)}
                      disabled={busyId === s.id || pending}
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                      onClick={() => void unsave(s)}
                      disabled={busyId === s.id || pending}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <ActionToast
        message={toast?.message ?? null}
        action={
          toast ? { label: "Undo", onClick: () => void undoUnsave({ ...toast }) } : null
        }
        onDismiss={() => setToast(null)}
      />
    </CardPanel>
  );
}
