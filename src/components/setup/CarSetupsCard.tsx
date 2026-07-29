"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

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
 */

export type CarLibrarySetup = {
  id: string;
  name: string | null;
  createdAtLabel: string;
  usedInRuns: number;
};

export function CarSetupsCard({
  carId,
  setups,
  label = "Setups",
}: {
  carId: string;
  setups: CarLibrarySetup[];
  /** Section label — "Saved setups" when it sits beside sheets and run setups. */
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <Link
          href={`/cars/${carId}/setups/new`}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
        >
          New setup
        </Link>
      </div>

      {setups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No saved setups yet. Create one and you&apos;ll be able to pick it when you log a run,
          then only change what&apos;s different.
        </p>
      ) : (
        <ul className="-mx-1">
          {setups.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 border-b border-border/60 px-1 py-2.5 last:border-0"
            >
              <Link href={`/cars/${carId}/setups/${s.id}/edit`} className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">{s.name ?? "Untitled setup"}</div>
                <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
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
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-destructive disabled:opacity-50"
                  onClick={() => void remove(s)}
                  disabled={busyId === s.id || pending}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </CardPanel>
  );
}
