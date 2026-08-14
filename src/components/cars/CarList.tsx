"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { HubRowTitle } from "@/components/ui/panel";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Collapse } from "@/components/ui/Collapse";
import { AddCarBlankUpload } from "@/components/cars/AddCarBlankUpload";
import { UploadSetupSheetBar, type UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";

type SetupSheetModelOption = { id: string; name: string; slug: string; isAuthorized?: boolean };

/** One saved (library) setup on a car, shown inline under the car row. */
export type CarInlineSetup = {
  id: string;
  name: string | null;
  createdAtLabel: string;
  usedInRuns: number;
};

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
  setupMetaById,
  setupsByCarId,
  uploadCars = [],
}: {
  initialCars: Car[];
  setupSheetModels?: SetupSheetModelOption[];
  /** Per-car setup line ("2 sheets · 20 setups · last run 19 Jul"), built server-side. */
  setupMetaById?: Record<string, string>;
  /**
   * Saved setups per car, listed inline so reading or editing one is a single tap from the Garage
   * tab (founder call 2026-07-29 — this replaced the duplicate setup cards on the old hub).
   */
  setupsByCarId?: Record<string, CarInlineSetup[]>;
  /**
   * The same car list the "Create / Upload setup sheet" bar above this one runs on, so an expanded
   * row can open that panel already pointed at its car. Empty falls back to a plain link.
   */
  uploadCars?: UploadSetupCar[];
}) {
  const router = useRouter();
  /**
   * Every row starts collapsed. The last-run car used to open itself, which made the list read as
   * if one car had been picked for you — a plain list of cars, all the same, is the point.
   */
  const [openCarId, setOpenCarId] = useState<string | null>(null);
  const uploadCarById = useMemo(
    () => new Map(uploadCars.map((c) => [c.id, c])),
    [uploadCars]
  );
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
  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [notes, setNotes] = useState("");
  const [setupSheetModelId, setSetupSheetModelId] = useState("");
  const [pending, setPending] = useState(false); // no setup sheet — the fallback, not the offer
  const [showUpload, setShowUpload] = useState(false); // "isn't listed" → upload your sheet
  /**
   * What the uploaded sheet already had in its boxes, waiting for a car to belong to.
   *
   * A finished sheet and a manufacturer's blank are not distinguishable, and both are worth
   * keeping — a blank carries the kit settings, which beats starting from nothing.
   */
  const [importedSetup, setImportedSetup] = useState<Record<string, unknown> | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Set when the car just added was the driver's first, so the confirmation can lead somewhere. */
  const [firstCarId, setFirstCarId] = useState<string | null>(null);

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
    setShowUpload(false);
    if (!nameDirty) setName(m.name); // auto-fill name from chassis (still editable)
  }

  /**
   * "My chassis isn't listed" now opens the upload panel instead of ending the conversation.
   * The old no-sheet car is still reachable, but from inside that panel — it is the fallback for a
   * sheet we cannot read, not the thing we offer first.
   */
  function chooseUploadBlank() {
    setSetupSheetModelId("");
    setPending(false);
    setShowUpload(true);
  }

  function chooseWithoutSheet() {
    setSetupSheetModelId("");
    setShowUpload(false);
    setPending(true);
  }

  function onChassisCreatedFromBlank(
    model: SetupSheetModelOption,
    summary: {
      totalBoxes: number;
      unnamedBoxes: number;
      merged: boolean;
      values: Record<string, unknown>;
      filledCount: number;
    }
  ) {
    setSetupSheetModels((prev) =>
      prev.some((m) => m.id === model.id) ? prev : [{ ...model, isAuthorized: false }, ...prev]
    );
    selectModel(model);
    // Held until the car exists — a setup needs a car to hang off. Saved by `handleAdd`.
    setImportedSetup(summary.filledCount > 0 ? summary.values : null);
    // Say what they got, in boxes. "289 parameters derived" is our word for it, not theirs.
    // A merge is said out loud: they typed one name and are now on a row called something else.
    const where = summary.merged
      ? `We already had this exact sheet — your car goes on “${model.name}”, with everyone else running it.`
      : `Chassis added from your sheet — ${summary.totalBoxes} boxes, where they sit on the paper.`;
    setMessage(
      summary.filledCount > 0
        ? `${where} ${summary.filledCount} boxes already had something in them, so that becomes your first setup.`
        : where
    );
  }

  function resetForm() {
    setName("");
    setNameDirty(false);
    setNotes("");
    setSetupSheetModelId("");
    setPending(false);
    setShowUpload(false);
    setImportedSetup(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const chosenName = name.trim() || selectedModel?.name || "";
    if (!chosenName) {
      setMessage("Name is required.");
      return;
    }
    if (!setupSheetModelId && !pending) {
      setMessage(
        showUpload
          ? "Add the chassis from your sheet first — or choose ‘I don’t have the sheet’."
          : "Choose a chassis type — or ‘My chassis isn’t listed’."
      );
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
      /*
       * The setup that came out of their sheet, now that there is a car to put it on.
       *
       * Saved after the car rather than with it, so a failure here costs them the setup and not the
       * car — they can re-upload the sheet, but a half-created car is a mess they cannot fix. Same
       * reason it does not block: the car is already theirs.
       */
      let importedSetupSaved = false;
      if (importedSetup && Object.keys(importedSetup).length > 0) {
        try {
          await jsonFetch("/api/setup-snapshots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              carId: car.id,
              name: "From your sheet",
              data: importedSetup,
            }),
          });
          importedSetupSaved = true;
        } catch {
          importedSetupSaved = false;
        }
      }

      // Their first car is the moment the app stops being empty — worth saying so, and worth
      // pointing at what it unlocks. Read before `setCars` or it is always false.
      const wasFirstCar = cars.length === 0;
      setCars((prev) => [car, ...prev]);
      const hadImport = Boolean(importedSetup && Object.keys(importedSetup).length > 0);
      resetForm();
      setAddOpen(false);
      setFirstCarId(wasFirstCar ? car.id : null);
      setMessage(
        hadImport && importedSetupSaved
          ? "Car added, with the setup from your sheet saved on it."
          : hadImport
            ? "Car added — but we couldn’t save the setup off your sheet. Try uploading it again from the car."
            : setupSheetModelId
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
                  Chassis type <span className="text-warning">*</span>
                </label>
                {/* Native select (founder decision 2026-07-14): the OS draws the menu —
                    no portal, no JS re-pin, no iOS rubber-banding. Sentinel values map
                    the old menu actions. */}
                <select
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                  value={pending || showUpload ? "__upload_blank__" : setupSheetModelId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__upload_blank__") return chooseUploadBlank();
                    if (!v) {
                      setSetupSheetModelId("");
                      setPending(false);
                      setShowUpload(false);
                      return;
                    }
                    const m = setupSheetModels.find((x) => x.id === v);
                    if (m) selectModel(m);
                  }}
                  aria-label="Chassis type"
                >
                  <option value="">Select chassis type…</option>
                  {/*
                    The flag goes on the UNREVIEWED rows, not the curated ones. Drivers can author
                    their own chassis types and those go live for everyone immediately, so the
                    catalog is now mostly-curated with driver rows mixed in — badging the good ones
                    made every unbadged row look equally trustworthy. Same rule as tracks and tires.
                  */}
                  {sortedModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.isAuthorized ? m.name : `${m.name} · Unreviewed`}
                    </option>
                  ))}
                  {/*
                    Was "add without a setup sheet", which made a car that could not hold one and
                    told nobody. Now it opens the upload panel: the driver's own blank sheet becomes
                    the chassis. The no-sheet car still exists, one step further in, for when the
                    sheet cannot be read.
                  */}
                  {/*
                    ONE way past the list, for everybody.
                    There used to be a second, admin-only entry here — "+ Create new chassis type…"
                    — which minted an empty chassis by name and left the founder to hand-build every
                    parameter. Two "not listed" options in one menu is a choice nobody should have to
                    make, and the upload is the better half of it anyway: the same chassis arrives
                    with its boxes and their positions already read off the paper. Hand-building an
                    empty one still exists, on the page that is for exactly that — /setup-sheet-models/new.
                  */}
                  <option value="__upload_blank__">My chassis isn’t listed — upload your setup sheet</option>
                </select>
                {showUpload ? (
                  <AddCarBlankUpload
                    onCreated={onChassisCreatedFromBlank}
                    onAddWithoutSheet={chooseWithoutSheet}
                  />
                ) : null}
                {selectedModel ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Uses the shared <span className="text-foreground">{selectedModel.name}</span> setup sheet.
                  </p>
                ) : pending ? (
                  <p className="mt-1 text-[11px] text-warning">
                    No setup sheet yet — community stats and structured setup tools won’t apply until your
                    chassis type is added.
                  </p>
                ) : showUpload ? null : (
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
                  aria-label="Car name"
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
                  aria-label="Car notes"
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
                {/* Only the failures belong here. Success collapses this form, so a
                    "Car added" written into it was never seen by anyone — the confirmation
                    now lives below, outside the Collapse. */}
                {message && !message.startsWith("Car added") && (
                  <span className="text-xs text-muted-foreground">{message}</span>
                )}
              </div>
            </form>
          </Collapse>
        </li>

        {/*
         * The confirmation, and — for their first car — the thing it unlocks.
         *
         * Measured 2026-08-13 across ten new-account walks: adding a car left the driver on
         * this page with no message (the old one was written into the form that had just
         * collapsed) and nothing pointing onward. The dashboard flipped to "You're ready — log
         * your first run", which they only ever saw if they thought to navigate back. That was
         * two of the two detours every single walk paid. Linking straight to the run skips both.
         */}
        {message?.startsWith("Car added") && (
          <li className="flex flex-col gap-2.5 px-3 py-3.5 sm:px-4" role="status">
            <p className="text-sm text-primary-ink">{message}</p>
            {firstCarId && (
              <Link href="/runs/new" className={cn(buttonLinkClassName("primary"), "self-start")}>
                Log your first run
              </Link>
            )}
          </li>
        )}

        {cars.length === 0 ? (
          <li className="px-4 py-4 text-sm text-muted-foreground">
            No cars yet. Add one above to log runs.
          </li>
        ) : (
          cars.map((c) => {
            const setups = setupsByCarId?.[c.id] ?? [];
            const expanded = openCarId === c.id;
            return (
              /* The row IS the link — tapping a car opens it. It used to expand into
                 "Edit parameters" / "Open car →", which made opening a car a two-tap
                 detour (2026-07-22). Sheet parameters live on the car page. The setup
                 count beside it is a separate control: it expands the saved setups in
                 place so a baseline is one tap from the Garage tab. */
              <li key={c.id}>
                <div className="flex items-stretch">
                  <Link
                    href={`/cars/${c.id}`}
                    prefetch
                    onClick={() => haptic("light")}
                    className="tap-active flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition hover:bg-muted/50 sm:px-4"
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
                          <span className="text-warning">
                            setup sheet coming
                          </span>
                        )}
                      </span>
                      {setupMetaById?.[c.id] ? (
                        <span className="ui-caption mt-0.5 block truncate tabular-nums">
                          {setupMetaById[c.id]}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>

                  {setupsByCarId ? (
                    <button
                      type="button"
                      onClick={() => {
                        haptic("light");
                        setOpenCarId(expanded ? null : c.id);
                      }}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Hide" : "Show"} setups for ${c.name}`}
                      className="tap-active flex shrink-0 items-center gap-1 border-l border-border px-3 text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
                    >
                      <span className="text-[11px] font-medium tabular-nums">{setups.length}</span>
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                        aria-hidden
                      />
                    </button>
                  ) : null}
                </div>

                {setupsByCarId ? (
                  <Collapse open={expanded}>
                    <div className="border-t border-border/60 bg-muted/20 px-3 py-2 sm:px-4">
                      {setups.length === 0 ? (
                        <p className="py-1 text-xs text-muted-foreground">
                          No saved setups yet — create one and you can pick it when you log a run.
                        </p>
                      ) : (
                        <ul>
                          {setups.map((s) => (
                            <li key={s.id}>
                              {/*
                                Straight to the editor for a setup nothing depends on. One a run
                                points at opens its detail page first, the same as the car page's
                                saved list — the editor there means "correct that run", which is
                                not what tapping a name from the Garage is asking for.
                              */}
                              <Link
                                href={
                                  s.usedInRuns > 0
                                    ? `/cars/${c.id}/setups/${s.id}`
                                    : `/cars/${c.id}/setups/${s.id}/edit`
                                }
                                onClick={() => haptic("light")}
                                className="tap-active flex items-center gap-3 border-b border-border/50 py-2 last:border-0"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-foreground">
                                    {s.name ?? "Untitled setup"}
                                  </span>
                                  <span className="block text-[11px] tabular-nums text-muted-foreground">
                                    {s.createdAtLabel}
                                    {s.usedInRuns > 0
                                      ? ` · ${s.usedInRuns} run${s.usedInRuns === 1 ? "" : "s"}`
                                      : ""}
                                  </span>
                                </span>
                                <ChevronRight
                                  className="h-4 w-4 shrink-0 text-muted-foreground"
                                  aria-hidden
                                />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                      {/*
                        The same panel the bar at the top of this page opens, already pointed at
                        this car. It used to be a link straight to a blank sheet, which made the
                        blank sheet the only way in from here — no upload, no baseline.
                      */}
                      {uploadCarById.get(c.id) ? (
                        <div className="mt-2">
                          <UploadSetupSheetBar
                            cars={[uploadCarById.get(c.id)!]}
                            trigger="link"
                            preselectCarId={c.id}
                          />
                        </div>
                      ) : (
                        <Link
                          href={`/cars/${c.id}/setups/new`}
                          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                        >
                          <Plus className="h-3 w-3" aria-hidden />
                          Create / Upload setup sheet
                        </Link>
                      )}
                    </div>
                  </Collapse>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </SurfaceCard>
  );
}
