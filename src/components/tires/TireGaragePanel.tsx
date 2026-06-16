"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import type { TireTypeOption } from "@/components/tires/TireTypeCombobox";

type TireSetRow = {
  id: string;
  label: string;
  setNumber: number;
  specificModel?: string | null;
  tireType?: { id: string; displayName: string; modelCode: string } | null;
};

export function TireGaragePanel({
  initialTireTypes,
}: {
  initialTireTypes: TireTypeOption[];
}) {
  const [tireTypes, setTireTypes] = useState(initialTireTypes);
  const [tireSets, setTireSets] = useState<TireSetRow[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingSets, setLoadingSets] = useState(true);

  const loadSets = useCallback(async () => {
    setLoadingSets(true);
    try {
      const res = await fetch("/api/tire-sets", { cache: "no-store" });
      const data = (await res.json()) as { tireSets?: TireSetRow[] };
      setTireSets(data.tireSets ?? []);
    } catch {
      setTireSets([]);
    } finally {
      setLoadingSets(false);
    }
  }, []);

  useEffect(() => {
    void loadSets();
  }, [loadSets]);

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
    } catch {
      setError("Failed to add tire type");
    } finally {
      setCreating(false);
    }
  }

  const setsByType = new Map<string, TireSetRow[]>();
  for (const ts of tireSets) {
    const key = ts.tireType?.id ?? "_legacy";
    const list = setsByType.get(key) ?? [];
    list.push(ts);
    setsByType.set(key, list);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="ui-title text-base">Tire types</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Broad compounds you log against — e.g. Sweep D32, Sweep D36. Add types here so they show up when you log a run.
          </p>
        </div>
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
            {creating ? "Adding…" : "Add tire type"}
          </button>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {tireTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tire types yet. Add your first compound above.</p>
        ) : (
          <ul className="rounded-lg border border-border divide-y divide-border bg-card">
            {tireTypes.map((t) => (
              <li key={t.id} className="px-4 py-3 text-sm font-medium">
                {t.displayName}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="ui-title text-base">Your tire sets</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Physical sets you&apos;ve linked while logging runs. Set numbers are assigned when you log a run, not here.
          </p>
        </div>
        {loadingSets ? (
          <p className="text-sm text-muted-foreground">Loading sets…</p>
        ) : tireSets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tire sets yet — pick a type and set number when you log a run.</p>
        ) : (
          <ul className="space-y-3">
            {tireTypes.map((t) => {
              const sets = (setsByType.get(t.id) ?? []).sort((a, b) => a.setNumber - b.setNumber);
              if (sets.length === 0) return null;
              return (
                <li key={t.id} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="px-4 py-2 bg-muted/30 text-sm font-medium border-b border-border">{t.displayName}</div>
                  <ul className="divide-y divide-border">
                    {sets.map((s) => (
                      <li key={s.id} className="px-4 py-2 text-sm flex flex-wrap gap-x-3 gap-y-1">
                        <span className="font-medium">#{s.setNumber}</span>
                        {s.specificModel ? (
                          <span className="text-muted-foreground">{s.specificModel}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
            {(setsByType.get("_legacy") ?? []).length > 0 ? (
              <li className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 bg-muted/30 text-sm font-medium border-b border-border">Legacy sets</div>
                <ul className="divide-y divide-border">
                  {(setsByType.get("_legacy") ?? []).map((s) => (
                    <li key={s.id} className="px-4 py-2 text-sm">
                      {s.label}
                      {s.setNumber >= 1 ? ` #${s.setNumber}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}
