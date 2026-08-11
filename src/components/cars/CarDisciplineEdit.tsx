"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CHASSIS_PLATFORMS, chassisPlatformLabel } from "@/lib/cars/carClasses";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

/**
 * Discipline override for a car the chassis catalog can't place.
 *
 * Deliberately **not** rendered when `disciplineForCar` already has an answer from the chassis —
 * that is the whole difference between this and the always-on `Car.carClass` picker dropped on
 * 2026-07-22 for reading as noise. Catalogued cars say what they are without being asked; only a
 * hand-built or user-created chassis gets a question, and only once.
 */
export function CarDisciplineEdit({
  carId,
  currentDiscipline,
}: {
  carId: string;
  /** Current `Car.carClass`; null when never set. */
  currentDiscipline: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentDiscipline ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = value !== (currentDiscipline ?? "");

  async function handleSave() {
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/cars/${carId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carClass: value || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || "Failed to update");
      setMessage("Saved.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardPanel contentClassName="text-sm space-y-2">
      <Eyebrow>Discipline</Eyebrow>
      <p className="text-[11px] text-muted-foreground">
        This chassis isn&apos;t in the catalog, so we can&apos;t tell what it races. Setting it
        keeps tyres and prep carrying correctly across a car swap, and scopes teammate lap
        comparisons to the same class.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Discipline"
        >
          <option value="">Not set</option>
          {CHASSIS_PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {dirty && (
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className={cn(
              buttonLinkClassName("primary"),
              saving && "opacity-70 pointer-events-none"
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
        {message && (
          <span
            className={cn(
              "text-xs",
              message === "Saved." ? "text-primary-ink" : "text-muted-foreground"
            )}
          >
            {message}
          </span>
        )}
      </div>
      {currentDiscipline && !dirty ? (
        <p className="text-[11px] text-muted-foreground">
          Currently{" "}
          <span className="font-medium text-foreground">
            {chassisPlatformLabel(currentDiscipline)}
          </span>
          .
        </p>
      ) : null}
    </CardPanel>
  );
}
