"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { CatalogVerifyControl } from "@/components/assets/CatalogVerifyControl";
import type { AdditiveTypeOption } from "@/components/additives/AdditiveTypeCombobox";

export function AdditiveGaragePanel({
  initialAdditiveTypes,
  isAdmin = false,
}: {
  initialAdditiveTypes: AdditiveTypeOption[];
  isAdmin?: boolean;
}) {
  const [additiveTypes, setAdditiveTypes] = useState(initialAdditiveTypes);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  async function addAdditiveType(e: React.FormEvent) {
    e.preventDefault();
    const displayName = newName.trim();
    if (!displayName) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/additive-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = (await res.json()) as {
        additiveType?: AdditiveTypeOption;
        existing?: AdditiveTypeOption;
        error?: string;
      };
      if (res.status === 409 && data.existing) {
        setAdditiveTypes((prev) => {
          if (prev.some((t) => t.id === data.existing!.id)) return prev;
          return [...prev, data.existing!].sort((a, b) => a.displayName.localeCompare(b.displayName));
        });
        setNewName("");
        return;
      }
      if (!res.ok || !data.additiveType) {
        setError(data.error ?? "Failed to add additive type");
        return;
      }
      setAdditiveTypes((prev) =>
        [...prev.filter((t) => t.id !== data.additiveType!.id), data.additiveType!].sort((a, b) =>
          a.displayName.localeCompare(b.displayName)
        )
      );
      setNewName("");
    } catch {
      setError("Failed to add additive type");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(t: AdditiveTypeOption) {
    setEditingId(t.id);
    setEditName(t.displayName);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  async function saveEdit(additiveTypeId: string) {
    const displayName = editName.trim();
    if (!displayName) return;
    setSavingId(additiveTypeId);
    setError(null);
    try {
      const res = await fetch(`/api/additive-types/${encodeURIComponent(additiveTypeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = (await res.json()) as { additiveType?: AdditiveTypeOption; error?: string };
      if (!res.ok || !data.additiveType) {
        setError(data.error ?? "Failed to update additive type");
        return;
      }
      setAdditiveTypes((prev) =>
        prev
          .map((t) => (t.id === additiveTypeId ? data.additiveType! : t))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
      );
      cancelEdit();
    } catch {
      setError("Failed to update additive type");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteAdditiveType(t: AdditiveTypeOption) {
    const ok = window.confirm(
      `Delete "${t.displayName}" from the catalog? Linked runs keep their label but lose this type link.`
    );
    if (!ok) return;
    setDeletingId(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/additive-types/${encodeURIComponent(t.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to delete additive type");
        return;
      }
      setAdditiveTypes((prev) => prev.filter((row) => row.id !== t.id));
      if (editingId === t.id) cancelEdit();
    } catch {
      setError("Failed to delete additive type");
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleVerify(t: AdditiveTypeOption) {
    const nextVerified = !t.verifiedAt;
    setVerifyingId(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/additive-types/${encodeURIComponent(t.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: t.displayName, verified: nextVerified }),
      });
      const data = (await res.json()) as { additiveType?: AdditiveTypeOption; error?: string };
      if (!res.ok || !data.additiveType) {
        setError(data.error ?? "Failed to update verification");
        return;
      }
      setAdditiveTypes((prev) => prev.map((row) => (row.id === t.id ? data.additiveType! : row)));
    } catch {
      setError("Failed to update verification");
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addAdditiveType} className="flex flex-wrap gap-2 items-start">
        <input
          className="flex-1 min-w-[12rem] rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          placeholder="e.g. Mighty Gripper - Yellow"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="New additive type name"
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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {additiveTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No additive types yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {additiveTypes.map((t) => (
            <li key={t.id}>
              <CardPanel contentClassName="px-4 py-3 flex flex-wrap items-center gap-2 justify-between">
                {editingId === t.id ? (
                  <>
                    <input
                      className="flex-1 min-w-[10rem] rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label="Edit additive type name"
                      autoFocus
                    />
                    <div className="flex gap-2">
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
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{t.displayName}</span>
                      {!t.verifiedAt && !isAdmin ? <CatalogVerifyControl verified={false} isAdmin={false} /> : null}
                    </span>
                    {isAdmin ? (
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
                          onClick={() => void deleteAdditiveType(t)}
                          className="text-xs px-3 py-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-60"
                        >
                          {deletingId === t.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </CardPanel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
