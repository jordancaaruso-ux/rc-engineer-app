"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";

export type TrackLayoutRow = {
  id: string;
  name: string;
  notes: string | null;
  sortOrder: number;
};

/** Local editing row — `id` is empty string for not-yet-saved rows. */
type DraftRow = { id: string; name: string; notes: string };

function toDraft(rows: TrackLayoutRow[]): DraftRow[] {
  return rows.map((r) => ({ id: r.id, name: r.name, notes: r.notes ?? "" }));
}

export function TrackLayoutsEditor({
  trackId,
  initialLayouts,
}: {
  trackId: string;
  initialLayouts: TrackLayoutRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DraftRow[]>(() => toDraft(initialLayouts));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function update(index: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setMessage(null);
  }

  function addRow() {
    setRows((prev) => [...prev, { id: "", name: "", notes: "" }]);
    setMessage(null);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setMessage(null);
  }

  function move(index: number, dir: -1 | 1) {
    setRows((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setMessage(null);
  }

  async function save() {
    const cleaned = rows
      .map((r) => ({ ...r, name: r.name.trim() }))
      .filter((r) => r.name.length > 0);
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/layouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layouts: cleaned.map((r) => ({
            id: r.id || undefined,
            name: r.name,
            notes: r.notes.trim() || null,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        layouts?: TrackLayoutRow[];
      };
      if (!res.ok) {
        setMessage(data.error ?? "Could not save layouts.");
        return;
      }
      if (data.layouts) setRows(toDraft(data.layouts));
      setMessage("Saved.");
      router.refresh();
    } catch {
      setMessage("Could not save layouts.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardPanel contentClassName="text-sm space-y-3">
      <div className="text-sm font-medium text-foreground">Layouts</div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Name the physical layouts this venue runs (e.g. &ldquo;Club layout&rdquo;, &ldquo;Nats config&rdquo;).
        You pick a layout &mdash; and optionally a direction (CW/CCW) &mdash; when logging a run or setting up an event.
      </p>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No layouts yet. Add one below.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.id || `new-${index}`} className="flex items-start gap-2">
              <div className="flex flex-col gap-1 pt-1">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={saving || index === 0}
                  onClick={() => move(index, -1)}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={saving || index === rows.length - 1}
                  onClick={() => move(index, 1)}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
              <div className="flex-1 space-y-1">
                <input
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                  value={row.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  placeholder="Layout name"
                  autoComplete="off"
                  maxLength={120}
                />
                <input
                  className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground outline-none"
                  value={row.notes}
                  onChange={(e) => update(index, { notes: e.target.value })}
                  placeholder="Notes (optional)"
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                aria-label="Remove layout"
                disabled={saving}
                onClick={() => removeRow(index)}
                className="pt-1 text-muted-foreground hover:text-destructive"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={addRow}
          className={cn(buttonLinkClassName("outline"), "text-xs px-3 py-1.5")}
        >
          + Add layout
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className={cn(buttonLinkClassName("primary"), "text-xs px-3 py-1.5", saving && "opacity-70")}
        >
          {saving ? "Saving…" : "Save layouts"}
        </button>
        {message ? (
          <span className={cn("text-xs", message === "Saved." ? "text-accent" : "text-muted-foreground")}>
            {message}
          </span>
        ) : null}
      </div>
    </CardPanel>
  );
}
