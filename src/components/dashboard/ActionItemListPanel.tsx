"use client";

import { GripVertical, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DashboardActionItemRow } from "@/lib/dashboardServer";
import { notifyIdeasItemAdded } from "@/lib/ideasTab";
import { primarySegmentButtonClassName } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

type ListParam = "try" | "do";

export function ActionItemListPanel({
  list,
  title,
  hint,
  addPlaceholder,
  addLabel,
  initialItems,
  embedded = false,
  variant = "pill",
  onItemsChange,
  maxVisible,
}: {
  list: ListParam;
  title: string;
  /** Short help line under the title. */
  hint?: string;
  addPlaceholder: string;
  /**
   * Accessible name for the add field. Defaults to `Add <title>`, which only reads well when
   * the title is a plural noun ("Add Things to do"). The try list is titled "Ideas" everywhere
   * since 2026-08-18, so it passes "Add an idea" rather than the ungrammatical "Add Ideas".
   */
  addLabel?: string;
  initialItems: DashboardActionItemRow[];
  embedded?: boolean;
  /**
   * Report the working list back to whoever seeded it, after every add, remove and reorder.
   *
   * Needed by any owner that outlives this component. `IdeasEdgeTab` unmounts the whole panel
   * on close, so without this its edits died with the mount and reopening re-seeded from the
   * snapshot fetched on first open — adds vanished, removed items came back, and only a page
   * reload agreed with the database (measured 2026-08-15). Owners re-rendered from the server
   * on every visit — the dashboard cards — don't need it and don't pass it.
   */
  onItemsChange?: (items: DashboardActionItemRow[]) => void;
  /**
   * "ledger" is the desktop column's hairline row (design handoff 2026-08-08): no pill,
   * a numbered index in place of the grip, and a heavier line of text. Behaviour is
   * identical — add, archive and drag-to-reorder are untouched, and the index IS the
   * drag affordance (it swaps to the grip on hover).
   */
  variant?: "pill" | "ledger";
  /**
   * Show only this many rows, with the rest behind a "+N more" line that expands in place.
   *
   * For the desktop dashboard (2026-08-18), where both lists sit in a fixed grid row and an
   * uncapped list is the one thing on the page that can push itself past the fold. Collapsed
   * is the default so page height stops depending on how many ideas you happen to have; one
   * click gets the whole list, and the driver chose that scroll.
   *
   * Reordering is unaffected — drag works on ids, and a hidden row cannot be dragged. Adds
   * land at the top, so a new item is always visible even while the tail is collapsed.
   */
  maxVisible?: number;
}) {
  const isLedger = variant === "ledger";
  const [items, setItems] = useState(initialItems);
  const [expanded, setExpanded] = useState(false);
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
    setItems(initialItems);
  }, [initialItems]);

  // Held in a ref so an owner that passes an inline arrow doesn't re-fire the report below
  // on every one of its own renders.
  const report = useRef(onItemsChange);
  useEffect(() => {
    report.current = onItemsChange;
  });

  // Skip the mount pass: the owner supplied `initialItems`, so echoing it straight back is
  // noise. Owners must store the array they are handed *by identity* — hand back a copy and
  // the reset effect above sees a new prop, sets state, and reports again, forever.
  const reported = useRef(false);
  useEffect(() => {
    if (!reported.current) {
      reported.current = true;
      return;
    }
    report.current?.(items);
  }, [items]);

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
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
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
        setItems(prev);
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setError(null);
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: DashboardActionItemRow = {
      id: optimisticId,
      text,
      sourceType: "MANUAL",
      createdAt: new Date().toISOString(),
      sourceRunId: null,
    };
    setItems((prev) => [...prev, optimistic]);
    setDraft("");
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
        setItems((prev) => prev.filter((i) => i.id !== optimisticId));
        setError("Already on your list.");
        return;
      }
      if (!res.ok || !j || !("item" in j) || !j.item) {
        setItems((prev) => prev.filter((i) => i.id !== optimisticId));
        setError(j && "error" in j ? (j.error ?? "Could not add item") : "Could not add item");
        return;
      }
      setItems((prev) =>
        prev.map((i) =>
          i.id === optimisticId
            ? { ...j.item!, createdAt: j.item!.createdAt }
            : i
        )
      );
      /*
       * Tell the edge tab something landed, so it nudges once and the driver knows
       * where the thing they just typed now lives. Announced only after the row is
       * actually saved — not off the optimistic insert above — because a nudge for an
       * add that then 409s or fails would be pointing at something that is not there.
       *
       * This panel is rendered BOTH on the dashboard and inside the tab's own drawer;
       * the listener ignores the event while the drawer is open, so the add rows do
       * not need to know which one they are.
       */
      notifyIdeasItemAdded();
    } catch {
      setItems((prev) => prev.filter((i) => i.id !== optimisticId));
      setError("Could not add item");
    } finally {
      setBusy(false);
    }
  }

  // Collapsed by default when a cap is set; expanding is one-way for the life of the mount,
  // because a list that snapped shut again after you scrolled it would fight you.
  const cap = maxVisible && !expanded ? maxVisible : null;
  const visibleItems = cap ? items.slice(0, cap) : items;
  const hiddenCount = items.length - visibleItems.length;

  const shell =
    embedded
      ? "rounded-md border-0 bg-transparent p-0 shadow-none"
      : "rounded-xl border border-border p-4 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.75)]";

  // In the ledger variant the card shell above supplies the title (and the count), so the
  // panel's own heading would be a second copy. Kept in the DOM for screen readers.
  const titleEl = isLedger ? (
    <h3 className="sr-only">{title}</h3>
  ) : (
    <Eyebrow dot="muted">{title}</Eyebrow>
  );

  const content = (
    <>
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
        {titleEl}
        {hint ? (
          <p
            className={
              embedded
                ? "text-[10px] leading-snug text-muted-foreground"
                : "text-[10px] leading-snug text-muted-foreground sm:max-w-[55%] sm:text-right"
            }
          >
            {hint}
          </p>
        ) : null}
      </div>

      <form onSubmit={addManual} className="mt-1.5 w-full">
        <div className="action-item-add-composite flex w-full min-w-0 items-stretch rounded-lg border border-border bg-card">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={addPlaceholder}
            className="min-w-0 flex-1 rounded-l-lg border-0 bg-transparent px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            disabled={busy}
            aria-label={addLabel ?? `Add ${title}`}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Add idea"
            className={primarySegmentButtonClassName(
              "relative z-[1] shrink-0 px-2.5 min-h-9 min-w-9"
            )}
          >
            <Plus className="size-4" strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      </form>

      {error ? <p className="mt-1.5 text-[11px] text-destructive">{error}</p> : null}
      {reorderErr ? <p className="mt-1.5 text-[11px] text-destructive">{reorderErr}</p> : null}

      {items.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">Nothing here yet — add above.</p>
      ) : (
        <>
        <ul className="mt-1.5 space-y-1">
          {visibleItems.map((i, rowIndex) => {
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
                  "group flex items-center justify-between gap-2",
                  isLedger
                    ? "gap-3 border-b border-border/70 py-[11px] last:border-b-0"
                    : "rounded-lg border border-border bg-muted/40 px-2.5 py-1.5",
                  draggingId === i.id && "opacity-50",
                  showDropAbove && "shadow-[inset_0_2px_0_0_rgb(var(--color-primary))]",
                  showDropBelow && "shadow-[inset_0_-2px_0_0_rgb(var(--color-primary))]"
                )}
              >
                <div
                  className={cn(
                    "shrink-0 cursor-grab select-none leading-none",
                    isLedger
                      ?"relative w-5 text-center text-[11px] tabular-nums text-faint"
                      : "px-0.5 text-muted-foreground/70"
                  )}
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isLedger ? (
                    <>
                      {/* The index IS the handle: it steps aside for the grip on hover
                          so the row keeps its numbered reading at rest. */}
                      <span aria-hidden className="group-hover:invisible">
                        {String(rowIndex + 1).padStart(2, "0")}
                      </span>
                      <GripVertical
                        className="invisible absolute inset-0 m-auto size-4 text-muted-foreground/70 group-hover:visible"
                        strokeWidth={2}
                        aria-hidden
                      />
                    </>
                  ) : (
                    <GripVertical className="size-4" strokeWidth={2} aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "font-medium leading-snug tracking-tight text-foreground whitespace-pre-wrap break-words",
                      isLedger ? "text-[14px] tracking-[-.01em]" : "text-sm"
                    )}
                  >
                    {i.text}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => archive(i.id)}
                  disabled={busy}
                  aria-label="Remove idea"
                  title="Remove"
                  className="tap-active -mr-0.5 flex shrink-0 items-center justify-center rounded-md p-1.5 min-h-9 min-w-9 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive/90 disabled:opacity-50"
                >
                  <X className="size-4" strokeWidth={2} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>

        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={cn(
              "tap-active mt-1 flex w-full items-center gap-2 text-[12px] font-semibold text-muted-foreground transition hover:text-foreground",
              isLedger ? "py-2" : "px-2.5 py-1.5"
            )}
          >
            +{hiddenCount} more
          </button>
        ) : null}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className={shell}>{content}</div>;
  }

  return <SurfaceCard variant="panel">{content}</SurfaceCard>;
}
