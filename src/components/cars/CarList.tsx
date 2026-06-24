"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { labelForSetupSheetTemplate } from "@/lib/setupSheetTemplateId";

type SetupSheetModelOption = { id: string; name: string; slug: string; isAuthorized?: boolean };

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
    if (initialSetupSheetModels.length > 0) return;
    fetch("/api/setup-sheet-models")
      .then((r) => r.json())
      .then((d: { models?: SetupSheetModelOption[]; pickerModels?: SetupSheetModelOption[] }) => {
        const list = Array.isArray(d.pickerModels) ? d.pickerModels : d.models;
        if (Array.isArray(list)) setSetupSheetModels(list);
      })
      .catch(() => {});
  }, [initialSetupSheetModels.length]);
  const [name, setName] = useState("");
  const [chassis, setChassis] = useState("");
  const [notes, setNotes] = useState("");
  const [setupSheetModelId, setSetupSheetModelId] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedQuery = modelQuery.trim().toLowerCase();
  const filteredModels = normalizedQuery
    ? setupSheetModels.filter((m) => m.name.toLowerCase().includes(normalizedQuery))
    : setupSheetModels;
  const exactModelMatch = setupSheetModels.find(
    (m) => m.name.trim().toLowerCase() === normalizedQuery
  );

  function selectModel(m: SetupSheetModelOption) {
    setSetupSheetModelId(m.id);
    setModelQuery(m.name);
    setModelOpen(false);
  }

  /** Resolve the chosen chassis to a model id, creating (or reusing) one for free-typed names. */
  async function resolveModelId(): Promise<string | null> {
    if (setupSheetModelId) return setupSheetModelId;
    const typed = modelQuery.trim();
    if (!typed) return null;
    if (exactModelMatch) return exactModelMatch.id;
    const { model } = await jsonFetch<{ model: { id: string; name: string; slug: string } }>(
      "/api/setup-sheet-models",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: typed }),
      }
    );
    return model.id;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage("Name is required.");
      return;
    }
    const wantsModel = Boolean(setupSheetModelId || modelQuery.trim());
    if (!wantsModel) {
      const ok = window.confirm(
        "Add this car without a chassis type? Community stats, setup compare, and structured setup tools work best when you link one (e.g. Mugen MTC3)."
      );
      if (!ok) return;
    }
    setMessage(null);
    setAdding(true);
    try {
      const modelId = await resolveModelId();
      const { car } = await jsonFetch<{ car: Car }>("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          chassis: chassis.trim() || null,
          notes: notes.trim() || null,
          setupSheetModelId: modelId,
        }),
      });
      setCars((prev) => [car, ...prev]);
      setName("");
      setChassis("");
      setNotes("");
      setSetupSheetModelId("");
      setModelQuery("");
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
      <CardPanel contentClassName="p-4">
      <form onSubmit={handleAdd} className="space-y-3">
        <Eyebrow>Add car (quick)</Eyebrow>
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
          <div className="relative">
            <label className="block text-[11px] text-muted-foreground mb-1">
              Chassis type <span className="text-amber-600 dark:text-amber-500">(recommended)</span>
            </label>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              value={modelQuery}
              placeholder="Search e.g. Mugen MTC3"
              onChange={(e) => {
                setModelQuery(e.target.value);
                setSetupSheetModelId("");
                setModelOpen(true);
              }}
              onFocus={() => setModelOpen(true)}
            />
            {modelOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-10 cursor-default"
                  aria-label="Close chassis menu"
                  onClick={() => setModelOpen(false)}
                />
                <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg">
                  {filteredModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => selectModel(m)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                    >
                      <span className="truncate">{m.name}</span>
                      {m.isAuthorized ? (
                        <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
                          Authorized
                        </span>
                      ) : null}
                    </button>
                  ))}
                  {modelQuery.trim() && !exactModelMatch ? (
                    <button
                      type="button"
                      onClick={() => setModelOpen(false)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-accent hover:bg-muted/60"
                    >
                      + Create chassis type “{modelQuery.trim()}”
                    </button>
                  ) : null}
                  {filteredModels.length === 0 && !modelQuery.trim() ? (
                    <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No chassis types yet.</p>
                  ) : null}
                </div>
              </>
            ) : null}
            {!setupSheetModelId && modelQuery.trim() && !exactModelMatch ? (
              <p className="mt-1 text-[11px] text-accent">
                New chassis type — it’ll be created and shared when you add the car.
              </p>
            ) : !setupSheetModelId && !modelQuery.trim() ? (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                Without a chassis type, community stats and Engineer spread won’t apply.
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
      </CardPanel>

      <div>
        <Eyebrow className="mb-2">Your cars</Eyebrow>
        {cars.length === 0 ? (
          <CardPanel className="text-sm text-muted-foreground">
            No cars yet. Add one above to log runs.
          </CardPanel>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {cars.map((c) => (
              <li key={c.id}>
                <Link href={`/cars/${c.id}`} prefetch className="tap-active block">
                  <CardPanel contentClassName="px-4 py-3 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{c.name}</span>
                      {c.chassis && <span className="text-muted-foreground text-sm ml-2">({c.chassis})</span>}
                      <span className="ui-caption block mt-0.5">
                        Setup sheet:{" "}
                        {c.setupSheetModel?.name ?? labelForSetupSheetTemplate(c.setupSheetTemplate ?? null)}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">{c.id.slice(0, 8)}</span>
                  </CardPanel>
                </Link>
                {c.setupSheetModelId ? (
                  <Link
                    href={`/setup-sheet-models/${c.setupSheetModelId}/schema`}
                    className="tap-active mt-1 block text-[10px] text-accent hover:underline"
                  >
                    Edit parameters
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
