"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { labelForSetupSheetTemplate } from "@/lib/setupSheetTemplateId";

type SetupSheetModelOption = { id: string; name: string; slug: string };

type Car = {
  id: string;
  name: string;
  chassis?: string | null;
  notes?: string | null;
  setupSheetTemplate?: string | null;
  setupSheetModelId?: string | null;
  setupSheetModel?: { id: string; name: string } | null;
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function CarList({
  initialCars,
  setupSheetModels: initialSetupSheetModels = [],
}: {
  initialCars: Car[];
  setupSheetModels?: SetupSheetModelOption[];
}) {
  const router = useRouter();
  const [cars, setCars] = useState<Car[]>(initialCars);
  const [setupSheetModels, setSetupSheetModels] =
    useState<SetupSheetModelOption[]>(initialSetupSheetModels);
  useEffect(() => {
    setCars(initialCars);
  }, [initialCars]);
  useEffect(() => {
    setSetupSheetModels(initialSetupSheetModels);
  }, [initialSetupSheetModels]);
  useEffect(() => {
    fetch("/api/setup-sheet-models")
      .then((r) => r.json())
      .then((d: { models?: SetupSheetModelOption[] }) => {
        if (Array.isArray(d.models)) setSetupSheetModels(d.models);
      })
      .catch(() => {});
  }, []);
  const [name, setName] = useState("");
  const [chassis, setChassis] = useState("");
  const [notes, setNotes] = useState("");
  const [setupSheetModelId, setSetupSheetModelId] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    if (!setupSheetModelId) {
      const ok = window.confirm(
        "Add this car without a setup sheet model? Community stats, setup compare, and structured setup tools work best when you link a model (create one in the setup wizard if needed)."
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
          setupSheetModelId: setupSheetModelId || null,
        }),
      });
      setCars((prev) => [car, ...prev]);
      setName("");
      setChassis("");
      setNotes("");
      setSetupSheetModelId("");
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
      <div className="rounded-lg border border-sky-500/35 bg-sky-500/5 p-4">
        <div className="ui-title text-sm text-sky-100/95">New car with custom setup sheet</div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Define parameters for a car model (e.g. Mugen MTC3), upload a PDF, and calibrate — without inheriting the
          Awesomatix A800 sheet.
        </p>
        <Link
          href="/cars/new/setup"
          className={cn(buttonLinkClassName("primary"), "mt-3 inline-flex text-sm")}
        >
          Start setup wizard
        </Link>
      </div>

      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-muted/70 p-4 space-y-3">
        <div className="ui-title text-sm text-muted-foreground">Add car (quick)</div>
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
              Setup sheet model <span className="text-amber-600 dark:text-amber-500">(recommended)</span>
            </label>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={setupSheetModelId}
              onChange={(e) => setSetupSheetModelId(e.target.value)}
            >
              <option value="">None</option>
              {setupSheetModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {setupSheetModels.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No models yet — use{" "}
                <Link href="/cars/new/setup" className="text-sky-400 hover:underline">
                  Start setup wizard
                </Link>{" "}
                to create one (e.g. Mugen MTC3).
              </p>
            ) : !setupSheetModelId ? (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                Without a model, community stats and Engineer spread won’t apply to this car.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={adding}
            className={cn(
              buttonLinkClassName("primary"),
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
          <CardPanel className="bg-muted/70 text-sm text-muted-foreground">
            No cars yet. Add one above to log runs.
          </CardPanel>
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
                    Setup sheet:{" "}
                    {c.setupSheetModel?.name ?? labelForSetupSheetTemplate(c.setupSheetTemplate ?? null)}
                  </span>
                  {c.setupSheetModelId ? (
                    <Link
                      href={`/setup-sheet-models/${c.setupSheetModelId}/schema`}
                      className="block text-[10px] text-sky-300 hover:underline mt-0.5"
                    >
                      Edit parameters
                    </Link>
                  ) : null}
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
