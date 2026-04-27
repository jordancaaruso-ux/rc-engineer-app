"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { DashboardActionItemRow } from "@/lib/dashboardServer";

type ListParam = "try" | "do";

export function ActionItemListPanel({
  list,
  title,
  hint,
  addPlaceholder,
  initialItems,
  embedded = false,
}: {
  list: ListParam;
  title: string;
  /** Short help line under the title. */
  hint: string;
  addPlaceholder: string;
  initialItems: DashboardActionItemRow[];
  embedded?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [reorderErr, setReorderErr] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    { itemId: string; edge: "above" | "below" } | null
  >(null);

  const listQuery = list === "do" ? "do" : "try";

  useEffect(() => {
    let alive = true;
    fetch(`/api/action-items?list=${encodeURIComponent(listQuery)}`)
      .then((res) => res.json().catch(() => null))
      .then((data: { items?: DashboardActionItemRow[] } | null) => {
        if (!alive || !data?.items) return;
        setItems(
          data.items.map((i) => ({
            id: i.id,
            text: i.text,
            sourceType: i.sourceType,
            createdAt: typeof i.createdAt === "string" ? i.createdAt : String(i.createdAt),
            sourceRunId: i.sourceRunId ?? null,
          }))
        );
      })
      .catch(() => {
        if (!alive) return;
      });
    return () => {
      alive = false;
    };
  }, [listQuery]);

  async function persistOrder(next: DashboardActionItemRow[]) {
    setReorderErr(null);
    setReorderBusy(true);
    try {
      const res = await fetch("/api/action-items/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list: listQuery, orderedIds: next.map((i) => i.id) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setReorderErr(j?.error ?? "Could not save order");
        return;
      }
    } catch {
      setReorderErr("Could not save order");
    } finally {
      setReorderBusy(false);
    }
  }

  function commitReorder(draggedId: string, targetId: string, edge: "above" | "below") {
    if (draggedId === targetId) return;
    const withoutDragged = items.filter((i) => i.id !== draggedId);
    const tIdx = withoutDragged.findIndex((i) => i.id === targetId);
    if (tIdx < 0) return;
    const dragged = items.find((i) => i.id === draggedId);
    if (!dragged) return;
    let insertAt: number;
    if (edge === "above") {
      insertAt = tIdx;
    } else {
      insertAt = tIdx + 1;
    }
    const next = [...withoutDragged.slice(0, insertAt), dragged, ...withoutDragged.slice(insertAt)];
    setItems(next);
    void persistOrder(next);
  }

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
        body: JSON.stringify({
          text,
          listKind: list === "do" ? "THINGS_TO_DO" : "THINGS_TO_TRY",
        }),
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
      setItems((prev) => [...prev.filter((i) => i.id !== row.id), row]);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  const shell =
    embedded
      ? "rounded-md border-0 bg-transparent p-0 shadow-none"
      : "rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/25";

  return (
    <div className={shell}>
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="text-sm font-medium tracking-tight text-foreground">{title}</div>
        <p
          className={
            embedded
              ? "text-[10px] leading-snug text-muted-foreground"
              : "text-[10px] leading-snug text-muted-foreground sm:max-w-[55%] sm:text-right"
          }
        >
          {hint}
        </p>
      </div>

      <form onSubmit={addManual} className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={addPlaceholder}
          className="min-w-[160px] flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
          disabled={busy}
          aria-label={`Add ${title}`}
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
      {reorderErr ? <p className="mt-1.5 text-[11px] text-destructive">{reorderErr}</p> : null}

      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Nothing here yet — add above or from Log your run.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((i) => {
            const showDropAbove = dropTarget?.itemId === i.id && dropTarget.edge === "above";
            const showDropBelow = dropTarget?.itemId === i.id && dropTarget.edge === "below";
            return (
              <li
                key={i.id}
                draggable={!reorderBusy}
                onDragStart={(e) => {
                  setDraggingId(i.id);
                  e.dataTransfer.effectAllowed = "move";
                  try {
                    e.dataTransfer.setData("text/plain", i.id);
                  } catch {
                    /* pass */
                  }
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTarget(null);
                }}
                onDragOver={(e) => {
                  if (!draggingId || draggingId === i.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const mid = rect.top + rect.height / 2;
                  const edge: "above" | "below" = e.clientY < mid ? "above" : "below";
                  setDropTarget((prev) =>
                    prev?.itemId === i.id && prev.edge === edge ? prev : { itemId: i.id, edge }
                  );
                }}
                onDragLeave={() => {
                  setDropTarget((prev) => (prev?.itemId === i.id ? null : prev));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragged = draggingId;
                  const edge = dropTarget?.edge ?? "below";
                  setDraggingId(null);
                  setDropTarget(null);
                  if (dragged && dragged !== i.id) {
                    void commitReorder(dragged, i.id, edge);
                  }
                }}
                className={cn(
                  "flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5",
                  draggingId === i.id && "opacity-50",
                  showDropAbove && "shadow-[inset_0_2px_0_0_var(--color-primary,#2563eb)]",
                  showDropBelow && "shadow-[inset_0_-2px_0_0_var(--color-primary,#2563eb)]"
                )}
              >
                <div
                  className="shrink-0 cursor-grab select-none px-0.5 pt-0.5 text-[10px] leading-none text-muted-foreground"
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  onClick={(e) => e.stopPropagation()}
                >
                  ⋮⋮
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-foreground whitespace-pre-wrap break-words">
                    {i.text}
                  </p>
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
