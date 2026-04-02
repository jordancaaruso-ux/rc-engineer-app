"use client";

import { useState } from "react";
import type { DashboardActionItemRow } from "@/lib/dashboardServer";

export function ThingsToTrySection({ initialItems }: { initialItems: DashboardActionItemRow[] }) {
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/action-items/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "Could not remove item");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setBusy(false);
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = (await res.json().catch(() => null)) as
        | { item?: DashboardActionItemRow & { createdAt: string } }
        | { error?: string }
        | null;
      if (res.status === 409) {
        setDraft("");
        setError("That is already on your list.");
        return;
      }
      if (!res.ok || !j || !("item" in j) || !j.item) {
        setError((j && "error" in j && j.error) || "Could not add item");
        return;
      }
      const row: DashboardActionItemRow = {
        id: j.item.id,
        text: j.item.text,
        sourceType: j.item.sourceType,
        createdAt: j.item.createdAt,
        sourceRunId: j.item.sourceRunId ?? null,
      };
      setItems((prev) => [row, ...prev.filter((i) => i.id !== row.id)]);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/25">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="text-sm font-medium tracking-tight text-foreground">Things to try</div>
        <p className="text-[10px] leading-snug text-muted-foreground sm:max-w-[55%] sm:text-right">
          From logged runs and manual adds. Remove archives the item.
        </p>
      </div>

      <form onSubmit={addManual} className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add an idea…"
          className="min-w-[160px] flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
          disabled={busy}
          aria-label="Add things to try"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {error ? <p className="mt-1.5 text-[11px] text-destructive">{error}</p> : null}

      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Nothing here yet — log a run with “Things to try” or add above.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-foreground whitespace-pre-wrap break-words">{i.text}</p>
                {i.sourceType !== "RUN" ? (
                  <p className="mt-0.5 text-sm font-medium text-muted-foreground">Manual</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => archive(i.id)}
                disabled={busy}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
