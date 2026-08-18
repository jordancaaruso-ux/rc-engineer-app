"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { CHASSIS_PLATFORMS, chassisPlatformLabel } from "@/lib/cars/carClasses";

/**
 * Everything the car itself is, as one settings list.
 *
 * Replaces the four cards that used to sit here (founder call 2026-08-18): a read-only "Car" facts
 * panel, a `CarDisciplineEdit` card carrying a 34-word explainer around a single dropdown, and that
 * dropdown's own "Currently 1/10 Touring." echo underneath it. Discipline was therefore stated
 * three times on one screen. It is stated once now, in the row that also changes it.
 *
 * The rule for a row: **label left, answer right, and if the answer can change you change it here.**
 * Nothing on this card explains itself in prose — a row that needs a paragraph is a row that is
 * asking the wrong question.
 */

type SheetModelOption = { id: string; name: string; slug: string };

type Props = {
  carId: string;
  name: string;
  /**
   * The chassis this car is linked to, if it has one. Once linked it is read-only here: the model
   * key is what community aggregations and setup compare bucket by, so re-pointing it is a job for
   * the upload door, not a dropdown on a settings list.
   */
  sheetModelName: string | null;
  /** Free-text chassis, from the Add-car form. Shown when nothing is linked. */
  chassisText: string | null;
  /**
   * Whether this car may still be linked to a chassis from the catalog — the old
   * `CarSetupSheetTemplateEdit` card's own render test. True for a car added by hand with no sheet,
   * which is the ordinary case, not an edge one.
   */
  canLinkChassis: boolean;
  notes: string | null;
  /**
   * What the chassis catalog says on its own, `null` when it can't place this chassis. Non-null
   * means the car answers for itself and the row is a fact, not a question — the same test that
   * decided whether the old discipline card rendered at all.
   */
  inferredDiscipline: string | null;
  /** Stored `Car.carClass` override; only ever offered when `inferredDiscipline` is null. */
  carClass: string | null;
  addedLabel: string;
  runCount: number;
};

export function CarDetailsCard(props: Props) {
  const router = useRouter();

  const [name, setName] = useState(props.name);
  const [notes, setNotes] = useState(props.notes ?? "");
  const [discipline, setDiscipline] = useState(props.carClass ?? "");

  const [editing, setEditing] = useState<"name" | "notes" | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* The catalog, fetched only for a car that could still be linked to one. */
  const [chassisOptions, setChassisOptions] = useState<SheetModelOption[]>([]);
  const offerChassisPicker = props.sheetModelName == null && props.canLinkChassis;
  useEffect(() => {
    if (!offerChassisPicker) return;
    let live = true;
    fetch("/api/setup-sheet-models")
      .then((r) => r.json())
      .then((d: { models?: SheetModelOption[] }) => {
        if (live) setChassisOptions(d.models ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [offerChassisPicker]);

  function flashSaved(field: string) {
    setSavedField(field);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedField(null), 1800);
  }

  async function patch(body: Record<string, unknown>, field: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/cars/${props.carId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't save that. Try again.");
      flashSaved(field);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openEdit(field: "name" | "notes") {
    setError(null);
    setDraft(field === "name" ? name : notes);
    setEditing(field);
  }

  async function commitEdit() {
    if (!editing) return;
    const value = draft.trim();
    if (editing === "name") {
      if (!value) {
        setError("A car needs a name.");
        return;
      }
      if (value === name) {
        setEditing(null);
        return;
      }
      if (await patch({ name: value }, "name")) {
        setName(value);
        setEditing(null);
      }
      return;
    }
    if (value === notes) {
      setEditing(null);
      return;
    }
    if (await patch({ notes: value || null }, "notes")) {
      setNotes(value);
      setEditing(null);
    }
  }

  /** Discipline saves the moment it is picked — the old Save button only appeared once you were
   *  already dirty, which meant the control changed shape while you were using it. */
  async function pickDiscipline(next: string) {
    const previous = discipline;
    setDiscipline(next);
    if (!(await patch({ carClass: next || null }, "discipline"))) setDiscipline(previous);
  }

  /** Linking a chassis re-renders the row as a fact, so there is nothing to hold in state. */
  async function pickChassis(next: string) {
    if (!next) return;
    await patch({ setupSheetModelId: next }, "chassis");
  }

  const resolvedDiscipline = chassisPlatformLabel(props.inferredDiscipline ?? discipline);

  return (
    <CardPanel contentClassName="space-y-3">
      <Eyebrow>Car</Eyebrow>

      <div className="grid text-[13px]">
        {/* Name */}
        {editing === "name" ? (
          <EditRow
            label="Name"
            value={draft}
            onChange={setDraft}
            onCommit={() => void commitEdit()}
            onCancel={() => setEditing(null)}
            busy={busy}
            placeholder="Car name"
          />
        ) : (
          <TapRow
            label="Name"
            onClick={() => openEdit("name")}
            saved={savedField === "name"}
            value={<span className="min-w-0 truncate">{name}</span>}
          />
        )}

        {/*
          Chassis. Linked, it is a fact. Unlinked, it is the one question worth asking on this card,
          and it absorbs the whole "Setup sheet model (car type for setup features)" panel that used
          to sit above — a heading in schema voice, a "Current:" echo, a Save button that appeared
          only once you were dirty, and thirty words about community aggregations and Engineer
          spread. The dropdown says what it does; none of that survived.
        */}
        {props.sheetModelName ? (
          <StaticRow label="Chassis" value={props.sheetModelName} />
        ) : offerChassisPicker ? (
          <SelectRow
            label="Chassis"
            value=""
            placeholder={props.chassisText ?? "Pick one"}
            options={chassisOptions.map((m) => ({ id: m.id, label: m.name }))}
            onPick={(v) => void pickChassis(v)}
            busy={busy}
            saved={savedField === "chassis"}
          />
        ) : (
          <StaticRow label="Chassis" value={props.chassisText ?? "Not set"} />
        )}

        {/* Discipline: a question only when the catalog can't answer, and never a paragraph. */}
        {props.inferredDiscipline == null ? (
          <SelectRow
            label="Discipline"
            value={discipline}
            placeholder="Pick one"
            options={CHASSIS_PLATFORMS.map((p) => ({ id: p.id, label: p.label }))}
            onPick={(v) => void pickDiscipline(v)}
            busy={busy}
            saved={savedField === "discipline"}
          />
        ) : resolvedDiscipline ? (
          <StaticRow label="Discipline" value={resolvedDiscipline} />
        ) : null}

        {/* Notes */}
        {editing === "notes" ? (
          <EditRow
            label="Notes"
            value={draft}
            onChange={setDraft}
            onCommit={() => void commitEdit()}
            onCancel={() => setEditing(null)}
            busy={busy}
            multiline
            placeholder="Anything worth remembering about this car"
          />
        ) : (
          <TapRow
            label="Notes"
            onClick={() => openEdit("notes")}
            saved={savedField === "notes"}
            value={
              notes ? (
                <span className="min-w-0 truncate">{notes}</span>
              ) : (
                <span className="text-muted-foreground">Add</span>
              )
            }
          />
        )}

        <StaticRow label="Added" value={props.addedLabel} figure />
        <StaticRow label="Runs" value={String(props.runCount)} figure last />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </CardPanel>
  );
}

const ROW = "flex items-baseline justify-between gap-3 border-b border-border/50 py-2.5";

function StaticRow({
  label,
  value,
  figure,
  last,
}: {
  label: string;
  value: string;
  figure?: boolean;
  last?: boolean;
}) {
  return (
    <div className={cn(ROW, last && "border-b-0 pb-0")}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right", figure && "fig-stat")}>{value}</span>
    </div>
  );
}

function SelectRow({
  label,
  value,
  placeholder,
  options,
  onPick,
  busy,
  saved,
}: {
  label: string;
  value: string;
  /** What the empty option reads as — the current free-text answer, or an invitation. */
  placeholder: string;
  options: Array<{ id: string; label: string }>;
  onPick: (value: string) => void;
  busy: boolean;
  saved: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {saved ? <SavedTick /> : null}
        <select
          className="max-w-[190px] truncate rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          value={value}
          disabled={busy}
          onChange={(e) => onPick(e.target.value)}
          aria-label={label}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

function TapRow({
  label,
  value,
  onClick,
  saved,
}: {
  label: string;
  value: React.ReactNode;
  onClick: () => void;
  saved: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        ROW,
        "tap-active w-full text-left transition hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      aria-label={`Edit ${label.toLowerCase()}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-baseline gap-2">
        {saved ? <SavedTick /> : null}
        {value}
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ›
        </span>
      </span>
    </button>
  );
}

function EditRow({
  label,
  value,
  onChange,
  onCommit,
  onCancel,
  busy,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  busy: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const shared =
    "w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex flex-col gap-2 border-b border-border/50 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          className={cn(shared, "min-h-[72px] resize-y")}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      ) : (
        <input
          className={shared}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit();
            }
            if (e.key === "Escape") onCancel();
          }}
          autoFocus
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCommit}
          disabled={busy}
          className="tap-active rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="tap-active rounded-md border border-border bg-card px-3 py-1.5 text-[12px] transition hover:bg-muted disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SavedTick() {
  return (
    <span className="shrink-0 text-[11px] font-semibold text-gain" aria-live="polite">
      Saved
    </span>
  );
}
