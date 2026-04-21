"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { labelForSetupSheetTemplate, SETUP_SHEET_TEMPLATE_OPTIONS } from "@/lib/setupSheetTemplateId";

type Car = {
  id: string;
  name: string;
  chassis?: string | null;
  notes?: string | null;
  setupSheetTemplate?: string | null;
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function CarList({ initialCars }: { initialCars: Car[] }) {
  const router = useRouter();
  const [cars, setCars] = useState<Car[]>(initialCars);
  useEffect(() => {
    setCars(initialCars);
  }, [initialCars]);
  const [name, setName] = useState("");
  const [chassis, setChassis] = useState("");
  const [notes, setNotes] = useState("");
  const [setupSheetTemplate, setSetupSheetTemplate] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    if (!setupSheetTemplate) {
      const ok = window.confirm(
        "Add this car without a setup sheet template? Engineer community spread, setup compare, and structured setup tools need a template. Choose “Awesomatix A800RR” if this car uses that sheet."
      );
      if (!ok) return;
    }
    setMessage(null);
    setAdding(true);
    try {
      const { car } = await jsonFetch<{ car: Car }>("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          chassis: chassis.trim() || null,
          notes: notes.trim() || null,
          setupSheetTemplate: setupSheetTemplate === "awesomatix_a800rr" ? "awesomatix_a800rr" : null,
        }),
      });
      setCars((prev) => [car, ...prev]);
      setName("");
      setChassis("");
      setNotes("");
      setSetupSheetTemplate("");
      setMessage("Car added. You can use it when logging a run.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add car");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-muted/70 p-4 space-y-3">
        <div className="ui-title text-sm text-muted-foreground">Add car</div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. TC6.2"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Chassis / model (optional)</label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={chassis}
              onChange={(e) => setChassis(e.target.value)}
              placeholder="e.g. Xray T4"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Notes (optional)</label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              Setup sheet template <span className="text-amber-600 dark:text-amber-500">(recommended)</span>
            </label>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={setupSheetTemplate}
              onChange={(e) => setSetupSheetTemplate(e.target.value)}
            >
              {SETUP_SHEET_TEMPLATE_OPTIONS.map((o) => (
                <option key={o.value || "none"} value={o.value}>{o.label}</option>
              ))}
            </select>
            {!setupSheetTemplate ? (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                Without a template, community stats and Engineer spread won’t apply to this car.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={adding}
            className={cn(
              "rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition",
              adding && "opacity-70 pointer-events-none"
            )}
          >
            {adding ? "Adding…" : "Add car"}
          </button>
          {message && (
            <span className={cn("text-xs", message.startsWith("Car added") ? "text-accent" : "text-muted-foreground")}>
              {message}
            </span>
          )}
        </div>
      </form>

      <div>
        <div className="ui-title text-sm text-muted-foreground mb-2">Your cars</div>
        {cars.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/70 p-4 text-sm text-muted-foreground">
            No cars yet. Add one above to log runs.
          </div>
        ) : (
          <ul className="rounded-lg border border-border divide-y divide-border">
            {cars.map((c) => (
              <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-2">
                <div>
                  <Link href={`/cars/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.chassis && <span className="text-muted-foreground text-sm ml-2">({c.chassis})</span>}
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    Setup type: {labelForSetupSheetTemplate(c.setupSheetTemplate ?? null)}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground font-mono">{c.id.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
