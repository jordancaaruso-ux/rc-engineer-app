"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { HubRowTitle } from "@/components/ui/panel";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Collapse } from "@/components/ui/Collapse";

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
  isAdmin = false,
}: {
  initialCars: Car[];
  setupSheetModels?: SetupSheetModelOption[];
  isAdmin?: boolean;
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

  const [addOpen, setAddOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [notes, setNotes] = useState("");
  const [setupSheetModelId, setSetupSheetModelId] = useState("");
  const [pending, setPending] = useState(false); // "my chassis isn't listed yet"
  const [showCreateType, setShowCreateType] = useState(false); // admin-only inline create
  const [newTypeName, setNewTypeName] = useState("");
  const [creatingType, setCreatingType] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedModel = setupSheetModels.find((m) => m.id === setupSheetModelId) ?? null;
  const sortedModels = [...setupSheetModels].sort((a, b) => a.name.localeCompare(b.name));

  /** Keep the auto-filled name in sync until the user hand-edits it. */
  function onNameChange(value: string) {
    setName(value);
    setNameDirty(value.trim().length > 0);
  }

  function selectModel(m: SetupSheetModelOption) {
    setSetupSheetModelId(m.id);
    setPending(false);
    setShowCreateType(false);
    if (!nameDirty) setName(m.name); // auto-fill name from chassis (still editable)
  }

  function chooseNotListed() {
    setSetupSheetModelId("");
    setPending(true);
    setShowCreateType(false);
  }

  async function createTypeFromName() {
    const typed = newTypeName.trim();
    if (!typed || creatingType) return;
    setCreatingType(true);
    setMessage(null);
    try {
      const { model } = await jsonFetch<{ model: SetupSheetModelOption }>("/api/setup-sheet-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: typed }),
      });
      setSetupSheetModels((prev) =>
        prev.some((m) => m.id === model.id) ? prev : [{ ...model, isAuthorized: false }, ...prev]
      );
      setNewTypeName("");
      selectModel(model);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create chassis type");
    } finally {
      setCreatingType(false);
    }
  }

  function resetForm() {
    setName("");
    setNameDirty(false);
    setNotes("");
    setSetupSheetModelId("");
    setPending(false);
    setShowCreateType(false);
    setNewTypeName("");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const chosenName = name.trim() || selectedModel?.name || "";
    if (!chosenName) {
      setMessage("Name is required.");
      return;
    }
    if (!setupSheetModelId && !pending) {
      setMessage("Choose a chassis type — or ‘My chassis isn’t listed yet’.");
      return;
    }
    setMessage(null);
    setAdding(true);
    try {
      const { car } = await jsonFetch<{ car: Car }>("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: chosenName,
          notes: notes.trim() || null,
          setupSheetModelId: setupSheetModelId || null,
        }),
      });
      setCars((prev) => [car, ...prev]);
      resetForm();
      setAddOpen(false);
      setMessage(
        setupSheetModelId
          ? "Car added. You can use it when logging a run."
          : "Car added — no setup sheet yet. We’ll flag it to add your chassis type."
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add car");
    } finally {
      setAdding(false);
    }
  }

  function toggleExpand(id: string) {
    haptic("light");
    setExpandedId((cur) => (cur === id ? null : id));
  }

  return (
    <SurfaceCard variant="panel" contentClassName="p-0" overflowHidden={false}>
      <ul className="divide-y divide-border">
        {/* Add car — collapsed to a row that opens the form in place. */}
        <li>
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setAddOpen((v) => !v);
            }}
            aria-expanded={addOpen}
            className="tap-active flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-muted/50 sm:px-4"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-secondary text-muted-foreground">
              <Plus className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <HubRowTitle as="span" className="block">
                Add car
              </HubRowTitle>
            </span>
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                addOpen && "rotate-90"
              )}
              aria-hidden
            />
          </button>

          <Collapse open={addOpen}>
            {/* overflow visible on the card so the native select menu isn't clipped */}
            <form onSubmit={handleAdd} className="space-y-3 px-3 pb-4 pt-1 sm:px-4">
              {/* Chassis type — the required, schema-driving field, first. */}
              <div className="relative">
                <label className="block text-[11px] text-muted-foreground mb-1">
                  Chassis type <span className="text-amber-600 dark:text-amber-500">*</span>
                </label>
                {/* Native select (founder decision 2026-07-14): the OS draws the menu —
                    no portal, no JS re-pin, no iOS rubber-banding. Sentinel values map
                    the old menu actions. */}
                <select
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                  value={pending ? "__not_listed__" : setupSheetModelId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__not_listed__") return chooseNotListed();
                    if (v === "__create__") {
                      // Keep the current selection; just reveal the create panel.
                      setShowCreateType(true);
                      return;
                    }
                    if (!v) {
                      setSetupSheetModelId("");
                      setPending(false);
                      return;
                    }
                    const m = setupSheetModels.find((x) => x.id === v);
                    if (m) selectModel(m);
                  }}
                  aria-label="Chassis type"
                >
                  <option value="">Select chassis type…</option>
                  {sortedModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.isAuthorized ? `${m.name} · Authorized` : m.name}
                    </option>
                  ))}
                  {/* Non-admins can't add types — let them proceed without one (flagged pending). */}
                  <option value="__not_listed__">My chassis isn’t listed yet — add without a setup sheet</option>
                  {/* Admin-only: mint a new global chassis type (custom setup sheet). */}
                  {isAdmin ? <option value="__create__">+ Create new chassis type…</option> : null}
                </select>
                {showCreateType && isAdmin ? (
                  <div className="mt-2 space-y-2 rounded-md border border-border bg-card p-2">
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
                      placeholder="New chassis type name, e.g. Mugen MTC3"
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      aria-label="New chassis type name"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void createTypeFromName()}
                        disabled={creatingType || !newTypeName.trim()}
                        className="btn-surface px-2 py-1 text-xs disabled:opacity-60"
                      >
                        {creatingType ? "Creating…" : "Create chassis type"}
                      </button>
                      <button
                        type="button"
                        className="px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setShowCreateType(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                {selectedModel ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Uses the shared <span className="text-foreground">{selectedModel.name}</span> setup sheet.
                  </p>
                ) : pending ? (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    No setup sheet yet — community stats and structured setup tools won’t apply until your
                    chassis type is added.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Required — pick the chassis so the car gets the right setup sheet.
                  </p>
                )}
              </div>

              {/* Name — auto-filled from the chassis type, editable (your nickname for the car). */}
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Name *</label>
                <input
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder={selectedModel?.name ?? "e.g. My MTC3"}
                  required
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

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={adding}
                  className={cn(buttonLinkClassName("primary"), adding && "opacity-70 pointer-events-none")}
                >
                  {adding ? "Adding…" : "Add car"}
                </button>
                {message && (
                  <span
                    className={cn(
                      "text-xs",
                      message.startsWith("Car added") ? "text-accent" : "text-muted-foreground"
                    )}
                  >
                    {message}
                  </span>
                )}
              </div>
            </form>
          </Collapse>
        </li>

        {cars.length === 0 ? (
          <li className="px-4 py-4 text-sm text-muted-foreground">
            No cars yet. Add one above to log runs.
          </li>
        ) : (
          cars.map((c) => {
            const expanded = expandedId === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggleExpand(c.id)}
                  aria-expanded={expanded}
                  className="tap-active flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-muted/50 sm:px-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">
                      <HubRowTitle as="span">{c.name}</HubRowTitle>
                      {c.chassis ? (
                        <span className="text-muted-foreground text-sm ml-2">({c.chassis})</span>
                      ) : null}
                    </span>
                    <span className="ui-caption mt-0.5 block">
                      {c.setupSheetModel?.name ?? (
                        <span className="text-amber-700 dark:text-amber-400">
                          setup sheet coming
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      expanded && "rotate-90"
                    )}
                    aria-hidden
                  />
                </button>

                <Collapse open={expanded}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pb-4 pt-0 sm:px-4">
                    {c.setupSheetModelId ? (
                      <Link
                        href={`/setup-sheet-models/${c.setupSheetModelId}/schema`}
                        className="tap-active text-xs text-accent hover:underline"
                      >
                        {isAdmin ? "Edit parameters" : "View parameters"}
                      </Link>
                    ) : (
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        No setup sheet linked yet
                      </span>
                    )}
                    <Link
                      href={`/cars/${c.id}`}
                      prefetch
                      className="tap-active text-xs text-muted-foreground hover:text-foreground"
                    >
                      Open car →
                    </Link>
                  </div>
                </Collapse>
              </li>
            );
          })
        )}
      </ul>
    </SurfaceCard>
  );
}
