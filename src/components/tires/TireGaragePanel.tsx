"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { HubRowTitle } from "@/components/ui/panel";
import { Collapse } from "@/components/ui/Collapse";
import { CollapsibleAddRow } from "@/components/assets/CollapsibleAddRow";
import { CatalogVerifyControl } from "@/components/assets/CatalogVerifyControl";
import type { TireTypeOption } from "@/components/tires/TireTypeCombobox";

export function TireGaragePanel({
  initialTireTypes,
  isAdmin = false,
}: {
  initialTireTypes: TireTypeOption[];
  isAdmin?: boolean;
}) {
  const [tireTypes, setTireTypes] = useState(initialTireTypes);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function toggleVerify(t: TireTypeOption) {
    const nextVerified = !t.verifiedAt;
    setVerifyingId(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/tire-types/${encodeURIComponent(t.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: t.displayName, verified: nextVerified }),
      });
      const data = (await res.json()) as { tireType?: TireTypeOption; error?: string };
      if (!res.ok || !data.tireType) {
        setError(data.error ?? "Failed to update verification");
        return;
      }
      setTireTypes((prev) => prev.map((row) => (row.id === t.id ? data.tireType! : row)));
    } catch {
      setError("Failed to update verification");
    } finally {
      setVerifyingId(null);
    }
  }

  async function addTireType(e: React.FormEvent) {
    e.preventDefault();
    const displayName = newName.trim();
    if (!displayName) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/tire-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = (await res.json()) as {
        tireType?: TireTypeOption;
        existing?: TireTypeOption;
        error?: string;
      };
      if (res.status === 409 && data.existing) {
        setTireTypes((prev) => {
          if (prev.some((t) => t.id === data.existing!.id)) return prev;
          return [...prev, data.existing!].sort((a, b) => a.displayName.localeCompare(b.displayName));
        });
        setNewName("");
        return;
      }
      if (!res.ok || !data.tireType) {
        setError(data.error ?? "Failed to add tire type");
        return;
      }
      setTireTypes((prev) =>
        [...prev.filter((t) => t.id !== data.tireType!.id), data.tireType!].sort((a, b) =>
          a.displayName.localeCompare(b.displayName)
        )
      );
      setNewName("");
      setAddOpen(false);
    } catch {
      setError("Failed to add tire type");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(t: TireTypeOption) {
    setEditingId(t.id);
    setEditName(t.displayName);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  async function saveEdit(tireTypeId: string) {
    const displayName = editName.trim();
    if (!displayName) return;
    setSavingId(tireTypeId);
    setError(null);
    try {
      const res = await fetch(`/api/tire-types/${encodeURIComponent(tireTypeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = (await res.json()) as { tireType?: TireTypeOption; error?: string };
      if (!res.ok || !data.tireType) {
        setError(data.error ?? "Failed to update tire type");
        return;
      }
      setTireTypes((prev) =>
        prev
          .map((t) => (t.id === tireTypeId ? data.tireType! : t))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
      );
      cancelEdit();
    } catch {
      setError("Failed to update tire type");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteTireType(t: TireTypeOption) {
    const ok = window.confirm(`Delete "${t.displayName}" from the catalog? Linked sets will keep their label but lose this type link.`);
    if (!ok) return;
    setDeletingId(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/tire-types/${encodeURIComponent(t.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to delete tire type");
        return;
      }
      setTireTypes((prev) => prev.filter((row) => row.id !== t.id));
      if (editingId === t.id) cancelEdit();
    } catch {
      setError("Failed to delete tire type");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive px-1">{error}</p> : null}

      <SurfaceCard variant="panel" contentClassName="p-0" overflowHidden={false}>
        <ul className="divide-y divide-border">
          <CollapsibleAddRow label="Add tire type" open={addOpen} onOpenChange={setAddOpen}>
            <form onSubmit={addTireType} className="flex flex-wrap gap-2 items-start">
              <input
                className="flex-1 min-w-[12rem] rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                placeholder="e.g. Sweep D32"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                aria-label="New tire type name"
              />
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className={cn(
                  buttonLinkClassName("primary"),
                  "text-sm px-4 py-2",
                  (creating || !newName.trim()) && "opacity-60 pointer-events-none"
                )}
              >
                {creating ? "Adding…" : "Add"}
              </button>
            </form>
          </CollapsibleAddRow>

          {tireTypes.length === 0 ? (
            <li className="px-4 py-4 text-sm text-muted-foreground">No tire types yet.</li>
          ) : (
            tireTypes.map((t) => {
              // Non-admins have no per-row actions — render a plain, non-expanding row.
              if (!isAdmin) {
                return (
                  <li key={t.id} className="flex items-center gap-2 px-4 py-3">
                    <HubRowTitle as="span" className="min-w-0 flex-1 truncate">
                      {t.displayName}
                    </HubRowTitle>
                    {!t.verifiedAt ? <CatalogVerifyControl verified={false} isAdmin={false} /> : null}
                  </li>
                );
              }
              const expanded = expandedId === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      setExpandedId((cur) => (cur === t.id ? null : t.id));
                    }}
                    aria-expanded={expanded}
                    className="tap-active flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-muted/50"
                  >
                    <HubRowTitle as="span" className="min-w-0 flex-1 truncate">
                      {t.displayName}
                    </HubRowTitle>
                    <CatalogVerifyControl verified={!!t.verifiedAt} isAdmin />
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        expanded && "rotate-90"
                      )}
                      aria-hidden
                    />
                  </button>

                  <Collapse open={expanded}>
                    <div className="px-4 pb-4 pt-0">
                      {editingId === t.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            className="flex-1 min-w-[10rem] rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            aria-label="Edit tire type name"
                            autoFocus
                          />
                          <button
                            type="button"
                            disabled={savingId === t.id || !editName.trim()}
                            onClick={() => void saveEdit(t.id)}
                            className={cn(
                              buttonLinkClassName("primary"),
                              "text-xs px-3 py-1.5",
                              (savingId === t.id || !editName.trim()) && "opacity-60 pointer-events-none"
                            )}
                          >
                            {savingId === t.id ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <CatalogVerifyControl
                            verified={!!t.verifiedAt}
                            isAdmin
                            pending={verifyingId === t.id}
                            onToggle={() => void toggleVerify(t)}
                          />
                          <button
                            type="button"
                            onClick={() => startEdit(t)}
                            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === t.id}
                            onClick={() => void deleteTireType(t)}
                            className="text-xs px-3 py-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-60"
                          >
                            {deletingId === t.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      )}
                    </div>
                  </Collapse>
                </li>
              );
            })
          )}
        </ul>
      </SurfaceCard>
    </div>
  );
}
