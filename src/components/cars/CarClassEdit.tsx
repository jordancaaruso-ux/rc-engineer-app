"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { CAR_CLASSES } from "@/lib/cars/carClasses";

/**
 * Car class / discipline picker (founder 2026-07-17). Saves on change.
 * The class drives the log-run car-swap rule (same class keeps the day's
 * tires + prep; different class re-derives them) — unset is fine and counts
 * as same-class.
 */
export function CarClassEdit({
  carId,
  currentClass,
}: {
  carId: string;
  currentClass: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentClass ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string) => {
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(carId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carClass: next || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || `Could not save (${res.status}).`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CardPanel contentClassName="space-y-2">
      <Eyebrow>Class</Eyebrow>
      <select
        value={value}
        onChange={(e) => void save(e.target.value)}
        disabled={saving}
        className="w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm text-foreground disabled:opacity-60"
        aria-label="Car class"
      >
        <option value="">Not set</option>
        {CAR_CLASSES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Used when you switch cars mid-log: same-class cars keep the day&apos;s tires and
        prep; a different class reloads them from that car&apos;s own last run.
      </p>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </CardPanel>
  );
}
