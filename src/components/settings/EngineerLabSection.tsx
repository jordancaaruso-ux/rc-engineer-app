"use client";

import { useCallback, useEffect, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Switch } from "@/components/ui/Switch";

/**
 * Engineer lab — admin-only, and the only way any extra context reaches the Engineer.
 *
 * The Engineer ships knowing nothing but the knowledge base (v0, 2026-08-05). Each switch here
 * hands it one more block of facts about the pinned run, for this account only, so a rung can be
 * judged in real use before anyone else ever sees it. Everything is off by default and off means
 * the shipped Engineer, byte for byte.
 */

type Rung = { id: string; label: string; description: string; on: boolean };

export function EngineerLabSection() {
  const [rungs, setRungs] = useState<Rung[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/engineer-lab");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { rungs: Rung[] };
      setRungs(data.rungs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the Engineer lab");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(rung: Rung, next: boolean) {
    setBusyId(rung.id);
    setError(null);
    // Optimistic: the switch should feel instant, and a failure re-syncs from the server below.
    setRungs((prev) => prev.map((r) => (r.id === rung.id ? { ...r, on: next } : r)));
    try {
      const res = await fetch("/api/admin/engineer-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rung: rung.id, on: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { active: string[] };
      setRungs((prev) => prev.map((r) => ({ ...r, on: data.active.includes(r.id) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that");
      void load();
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = rungs.filter((r) => r.on).length;

  return (
    <CardPanel className="mt-10">
      <h2 className="text-sm font-semibold text-foreground">Engineer lab (admin)</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        The Engineer knows the knowledge base and nothing else. Each switch gives it one more
        block of facts about the run you have pinned — for your account only. Nobody else&rsquo;s
        Engineer changes.
      </p>

      {loading ? (
        <p className="mt-4 text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rungs.map((rung) => (
            <div key={rung.id} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-foreground">{rung.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {rung.description}
                </p>
              </div>
              <Switch
                checked={rung.on}
                disabled={busyId === rung.id}
                ariaLabel={`${rung.label} — ${rung.on ? "on" : "off"}`}
                onChange={(next) => void toggle(rung, next)}
              />
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {activeCount === 0
          ? "All off — you are on the shipped Engineer, so your ratings keep building its baseline."
          : "Answers with facts attached are stamped as lab answers, so they stay out of the shipped Engineer's ratings. Ask an unpinned question and you are back on the shipped one."}
      </p>

      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </CardPanel>
  );
}
