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
import { PickerSheet, PickerTrigger } from "@/components/ui/PickerSheet";
import { SetUpHandoffBar } from "@/components/onboarding/SetUpHandoffBar";
import { carNameTakenMessage, findCarNameClash } from "@/lib/cars/carName";
import { setupUsageLabel } from "@/lib/setup/setupRemoveMode";
import type { OptionSection } from "@/lib/search/optionSearch";

type SetupSheetModelOption = { id: string; name: string; slug: string; isAuthorized?: boolean };

/** One saved (library) setup on a car, shown inline under the car row. */
export type CarInlineSetup = {
  id: string;
  name: string | null;
  createdAtLabel: string;
  /** Logged runs whose record IS this setup. */
  runCount: number;
  /** Runs and setups that STARTED from it — a different fact, and it used to be added to the above. */
  derivedCount: number;
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
  hasTimingIdentity = true,
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
  /**
   * Whether lap times can already find this driver. Only read by the first-car
   * confirmation below: without it, adding a car is not the moment to hand over the
   * run — the run would save, but every lap would have to be typed in by hand.
   * Defaults to `true` so any other caller keeps the plain run hand-off.
   */
  hasTimingIdentity?: boolean;
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
  const [chassisPickerOpen, setChassisPickerOpen] = useState(false);
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

  /**
   * The name this car would actually be saved under — what is typed, or the chassis name that
   * auto-filled it — checked against the garage as they type, so "already taken" lands before they
   * press Add rather than as a failure afterwards. The API refuses it either way.
   */
  const chosenName = name.trim() || selectedModel?.name || "";
  const nameClash = useMemo(
    () => findCarNameClash(cars, chosenName),
    [cars, chosenName]
  );

  /*
   * The flag goes on the UNREVIEWED rows, not the curated ones. Drivers can author their own
   * chassis types and those go live for everyone immediately, so the catalog is now
   * mostly-curated with driver rows mixed in — badging the good ones made every unbadged row
   * look equally trustworthy. Same rule as tracks and tires.
   */
  const chassisSections = useMemo<OptionSection[]>(
    () => [
      {
        key: "all",
        label: null,
        options: [...setupSheetModels]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((m) => ({
            value: m.id,
            label: m.name,
            detail: m.isAuthorized ? null : "Unreviewed",
            keywords: m.slug.replace(/_/g, " "),
          })),
      },
    ],
    [setupSheetModels]
  );

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
    /*
     * Nothing is announced for the ordinary case. A box count and a promise about a first setup was
     * a paragraph of small print beside the Add car button, describing work the driver could
     * already see land: the chassis field now holds their chassis, the name filled itself in, and
     * "Car added, with the setup from your sheet saved on it" says the rest a moment later.
     *
     * A MERGE still speaks, because it is the one thing the screen does not show: they typed one
     * name and are now on a row called something else, shared with everyone running that sheet.
     */
    setMessage(
      summary.merged
        ? `We already had this exact sheet — your car goes on “${model.name}”, with everyone else running it.`
        : null
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
    if (!chosenName) {
      setMessage("Name is required.");
      return;
    }
    if (nameClash) {
      setMessage(carNameTakenMessage(nameClash.name));
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
            {/* overflow stays visible on the card — legacy of the native select era, harmless now
                that the picker sheet portals to <body> */}
            <form onSubmit={handleAdd} className="space-y-3 px-3 pb-4 pt-1 sm:px-4">
              {/* Chassis type — the required, schema-driving field, first. */}
              <div className="relative">
                <label className="block text-[11px] text-muted-foreground mb-1">
                  Chassis type <span className="text-warning">*</span>
                </label>
                {/* A `PickerSheet`, same as tire compound and track on the log-run form (founder
                    call 2026-08-14, replacing the 2026-07-14 native select): the catalog is
                    growing past the iOS five-row wheel, and the sheet brings type-to-search and
                    a real "isn't listed" affordance with it. */}
                <PickerTrigger
                  onClick={() => setChassisPickerOpen(true)}
                  open={chassisPickerOpen}
                  aria-label="Chassis type"
                  placeholder={!selectedModel && !pending && !showUpload}
                  className="rounded-md border border-border bg-card"
                >
                  {selectedModel
                    ? selectedModel.name
                    : pending || showUpload
                      ? "My chassis isn’t listed — upload your setup sheet"
                      : "Select chassis type…"}
                </PickerTrigger>
                <PickerSheet
                  open={chassisPickerOpen}
                  onClose={() => setChassisPickerOpen(false)}
                  title="Chassis type"
                  value={pending || showUpload ? "" : setupSheetModelId}
                  onSelect={(id) => {
                    setChassisPickerOpen(false);
                    if (!id) {
                      setSetupSheetModelId("");
                      setPending(false);
                      setShowUpload(false);
                      return;
                    }
                    const m = setupSheetModels.find((x) => x.id === id);
                    if (m) selectModel(m);
                  }}
                  sections={chassisSections}
                  searchPlaceholder="Search chassis types…"
                  clearRow={{ label: "Select chassis type…" }}
                  // ONE way past the list, for everybody — the footer, exactly where the tire and
                  // track sheets keep theirs. It opens the blank-sheet upload panel: the driver's
                  // own PDF becomes the chassis, boxes and positions read off the paper. The
                  // no-sheet car still exists, one step further in, for when the sheet cannot be
                  // read. Hand-building an empty chassis stays on /setup-sheet-models/new.
                  footer={
                    <button
                      type="button"
                      onClick={() => {
                        setChassisPickerOpen(false);
                        chooseUploadBlank();
                      }}
                      className="tap-active w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-primary-ink transition hover:bg-white/5"
                    >
                      + My chassis isn&rsquo;t listed — upload your setup sheet…
                    </button>
                  }
                  emptyAction={() => (
                    <button
                      type="button"
                      onClick={() => {
                        setChassisPickerOpen(false);
                        chooseUploadBlank();
                      }}
                      className="tap-active rounded-lg border border-border px-3 py-2 text-sm font-semibold text-primary-ink transition hover:bg-white/5"
                    >
                      Upload your setup sheet
                    </button>
                  )}
                />
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
                  aria-invalid={nameClash ? true : undefined}
                  required
                />
                {nameClash && (
                  <p className="mt-1 text-[11px] text-warning">
                    {carNameTakenMessage(nameClash.name)}
                  </p>
                )}
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

              {/*
                The committing action of the form, sized like one. It used to be the same small
                chip the card uses for a link, with whatever the form had to say wrapped alongside
                it — so the row's height moved with the length of a sentence and the button was the
                smaller half of it. Full width and a 44px tap target on a phone, its natural width
                once there is room; anything the form has to say goes underneath, on its own line.
              */}
              <div className="space-y-2 pt-1">
                <button
                  type="submit"
                  disabled={adding}
                  className={cn(
                    buttonLinkClassName("primary"),
                    "min-h-11 w-full px-4 text-sm sm:w-auto sm:min-w-44",
                    adding && "pointer-events-none opacity-70"
                  )}
                >
                  {adding ? "Adding…" : "Add car"}
                </button>
                {/* Only the failures belong here. Success collapses this form, so a
                    "Car added" written into it was never seen by anyone — the confirmation
                    now lives below, outside the Collapse. */}
                {message && !message.startsWith("Car added") && (
                  <p role="status" className="text-xs text-warning">
                    {message}
                  </p>
                )}
              </div>
            </form>
          </Collapse>
        </li>
        {/*
         * The confirmation, and — for their first car — where to go next.
         *
         * Measured 2026-08-13 across ten new-account walks: adding a car left the driver on
         * this page with no message (the old one was written into the form that had just
         * collapsed) and nothing pointing onward. The dashboard flipped to "You're ready — log
         * your first run", which they only ever saw if they thought to navigate back. That was
         * two of the two detours every single walk paid. Pointing onward from here skips both.
         *
         * It points at the DASHBOARD, not at the next step (founder 2026-08-26, replacing the
         * 08-18 jump straight to /settings). Naming the destination here meant this page had to
         * know which step was outstanding, so the checklist existed in two places and could
         * disagree. Now the car page only hands back; the Get-set-up card owns the order and is
         * already sitting in its "Car's in — one thing left" state when they land. It costs one
         * tap, and buys the driver seeing their own checklist tick over — which is the whole
         * reward for having done the step.
         *
         * The button is worded as the journey, not the step ("Continue setting up"), and the
         * "Log a run anyway" link under it came out on 08-18: the dock's run control never left
         * the screen, so the link was a second door to the same room sitting directly under the
         * one thing we're asking them to do.
         */}
        {message?.startsWith("Car added") && (
          <li className="flex flex-col gap-2.5 px-3 py-3.5 sm:px-4" role="status">
            <p className="text-sm text-primary-ink">{message}</p>
            {firstCarId && (
              /*
               * The SAME bar Settings raises, in the same place — pinned at the top of
               * the screen and staying there through the scroll (founder 2026-08-26).
               * It used to be a grey explanatory line above a `self-start` chip, sitting
               * here in the list: two elements saying one thing, the chip did not read as
               * the way on, and both scrolled away the moment the driver looked at their
               * new car. `SetUpHandoffBar` carries the whole treatment; only `direction`
               * differs between the two call sites (this one goes forward).
               *
               * The "Car added" line above stays put — that is the confirmation, and it
               * belongs beside the list it is confirming.
               */
              <SetUpHandoffBar
                href="/"
                direction="forward"
                title="Continue setting up"
                detail={
                  hasTimingIdentity
                    ? "Your checklist is on the dashboard"
                    : "Timing next — your name and transponder, so lap times find you"
                }
              />
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
                                Always the READ view — same door as the car page's saved list.
                                A never-run setup used to skip straight into the editor, which
                                meant a PDF import opened on the fill surface with no Compare, no
                                PDF, no share (founder, 2026-09-01). Edit is one tap away there.
                              */}
                              <Link
                                href={`/cars/${c.id}/setups/${s.id}`}
                                onClick={() => haptic("light")}
                                className="tap-active flex items-center gap-3 border-b border-border/50 py-2 last:border-0"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-foreground">
                                    {s.name ?? "Untitled setup"}
                                  </span>
                                  <span className="block text-[11px] tabular-nums text-muted-foreground">
                                    {s.createdAtLabel}
                                    {setupUsageLabel(s) ? ` · ${setupUsageLabel(s)}` : ""}
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
