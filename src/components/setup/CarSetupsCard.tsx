"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { setupFillDraftProgressLabel } from "@/lib/setup/setupFillDraft";

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
 * the values afterwards would rewrite what that run says it ran. Those rows offer Rename, never
 * Delete — the API refuses both edits, and the row should not offer what it cannot do.
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
  usedInRuns: number;
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
      const res = await fetch(`/api/setup-snapshots/${setup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not rename this setup.");
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename this setup.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (setup: CarLibrarySetup) => {
    const label = setup.name ?? "this setup";
    if (!window.confirm(`Delete "${label}"? Runs already logged keep their own setup record.`)) {
      return;
    }
    setBusyId(setup.id);
    setError(null);
    try {
      const res = await fetch(`/api/setup-snapshots/${setup.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not delete this setup.");
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this setup.");
    } finally {
      setBusyId(null);
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
          {setups.map((s) => (
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
                  {s.usedInRuns > 0
                    ? ` · ${s.usedInRuns} run${s.usedInRuns === 1 ? "" : "s"}`
                    : ""}
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
                {/* Deleting a run's record is refused by the API — don't offer the door. */}
                {s.usedInRuns === 0 ? (
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-destructive disabled:opacity-50"
                    onClick={() => void remove(s)}
                    disabled={busyId === s.id || pending}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </CardPanel>
  );
}
