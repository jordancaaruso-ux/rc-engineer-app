"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import {
  BASELINE_KIND_LABEL,
  baselineContextLabel,
  type BaselineSetupKindValue,
} from "@/lib/baselineSetups/baselineSetupShape";

/**
 * The baselines published against one chassis, on the chassis workbench. Everyone can read the
 * list; only an admin sees Add / Edit / Delete.
 *
 * Deleting is allowed even after drivers have copied one — their copy holds its own values
 * (`SetupSnapshot.sourceBaselineId` is `onDelete: SetNull`), so nothing they saved is lost.
 */

export type ChassisBaselineRow = {
  id: string;
  name: string;
  kind: BaselineSetupKindValue;
  notes: string | null;
  surface: string | null;
  gripLevel: string | null;
  valueCount: number;
  copyCount: number;
};

export function ChassisBaselineList({
  modelId,
  baselines,
  isAdmin,
}: {
  modelId: string;
  baselines: ChassisBaselineRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (row: ChassisBaselineRow) => {
    const warning =
      row.copyCount > 0
        ? `Delete "${row.name}"? ${row.copyCount} driver cop${
            row.copyCount === 1 ? "y" : "ies"
          } keep their own values.`
        : `Delete "${row.name}"?`;
    if (!window.confirm(warning)) return;
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/baseline-setups/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not delete this baseline.");
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this baseline.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <CardPanel contentClassName="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Baseline setups</Eyebrow>
        {isAdmin ? (
          <Link
            href={`/setup-sheet-models/${modelId}/baselines/new`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          >
            New baseline
          </Link>
        ) : null}
      </div>

      {baselines.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {isAdmin
            ? "No baselines yet — drivers start from empty or their own last setup."
            : "No baselines published for this chassis yet."}
        </p>
      ) : (
        <ul className="-mx-1">
          {baselines.map((b) => {
            const context = baselineContextLabel(b);
            return (
              <li
                key={b.id}
                className="flex items-start justify-between gap-3 border-b border-border/60 px-1 py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {BASELINE_KIND_LABEL[b.kind]}
                    </span>
                    <span className="truncate text-sm text-foreground">{b.name}</span>
                  </div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {b.valueCount} values
                    {context ? ` · ${context}` : ""}
                    {b.copyCount > 0 ? ` · ${b.copyCount} saved` : ""}
                  </div>
                  {b.notes ? (
                    <p className="mt-1 text-xs text-muted-foreground">{b.notes}</p>
                  ) : null}
                </div>
                {isAdmin ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/setup-sheet-models/${modelId}/baselines/${b.id}/edit`}
                      className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-destructive disabled:opacity-50"
                      onClick={() => void remove(b)}
                      disabled={busyId === b.id || pending}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </CardPanel>
  );
}
