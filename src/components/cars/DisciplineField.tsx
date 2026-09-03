"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  RACE_CLASSES,
  POWER_TYPES,
  formatDiscipline,
  parseDiscipline,
  raceClass,
  type PowerId,
} from "@/lib/cars/carClasses";

/**
 * The "what it races" question, in one place — the class it runs in, and what powers it.
 *
 * Two doors ask it (the add-a-chassis-from-your-PDF card, and the Discipline row on a car page)
 * and they used to own a copy of the dropdown each. One control now, because the answer's shape
 * changed on 2026-09-03: it is no longer one pick off a flat list of thirteen, it is a class from
 * a grouped list of seventeen PLUS electric-or-nitro, and for "Other" a name the driver types.
 *
 * The order it asks in is the order it renders: class, then its name if it needs one, then power.
 * **The power rail only appears once a class exists** — nothing is gained by putting an
 * Electric/Nitro choice on screen before there is anything for it to power, and a first render
 * with one control in it is a question, where three is a form.
 *
 * `onChange` is handed the finished stored value, or `""` while the answer is still half made —
 * so a caller never has to know the encoding, and can't accidentally save a class with no power.
 * The parent holds no partial state; this component does, because a half-answer has no spelling.
 */
export function DisciplineField({
  value,
  onChange,
  disabled,
  className,
  selectClassName,
}: {
  /** The stored answer to open on, if there is one. Read once — this control owns it after that. */
  value: string | null | undefined;
  /** The finished value, or `""` while incomplete. */
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  /** The class select's own sizing, so a settings row and a form card can differ. */
  selectClassName?: string;
}) {
  const initial = parseDiscipline(value);
  const [classId, setClassId] = useState(initial?.classId ?? "");
  const [power, setPower] = useState<PowerId | "">(initial?.power ?? "");
  const [otherLabel, setOtherLabel] = useState(initial?.otherLabel ?? "");

  const cls = raceClass(classId);
  const needsName = cls?.freeText === true;

  function emit(next: { classId?: string; power?: PowerId | ""; otherLabel?: string }) {
    onChange(
      formatDiscipline({
        classId: next.classId ?? classId,
        power: (next.power ?? power) || null,
        otherLabel: next.otherLabel ?? otherLabel,
      })
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/*
        A native select, grouped Onroad / Offroad. Seventeen fixed options with two headings is
        exactly what `<optgroup>` is for, and a native select brings the platform's own wheel on a
        phone — better than anything a PickerSheet would do for a list nobody needs to search.
        The "Choose…" option disappears once an answer exists: leaving it there offers a driver a
        way to un-answer a required question, and nothing downstream can store the result.
      */}
      <select
        className={cn(
          "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
          selectClassName
        )}
        value={classId}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setClassId(next);
          if (!raceClass(next)?.freeText) setOtherLabel("");
          emit({ classId: next, otherLabel: raceClass(next)?.freeText ? otherLabel : "" });
        }}
        aria-label="What it races"
      >
        {classId ? null : <option value="">Choose…</option>}
        <optgroup label="Onroad">
          {RACE_CLASSES.filter((c) => c.surface === "onroad").map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Offroad">
          {RACE_CLASSES.filter((c) => c.surface === "offroad").map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </optgroup>
      </select>

      {needsName ? (
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          placeholder="Name the class"
          value={otherLabel}
          disabled={disabled}
          maxLength={60}
          onChange={(e) => {
            setOtherLabel(e.target.value);
            emit({ otherLabel: e.target.value });
          }}
          aria-label="Name the class"
        />
      ) : null}

      {classId ? (
        <SegmentedControl<PowerId | "">
          options={POWER_TYPES.map((p) => ({ value: p.id, label: p.label }))}
          value={power}
          onChange={(next) => {
            if (disabled || !next) return;
            setPower(next);
            emit({ power: next });
          }}
          ariaLabel="Electric or nitro"
          size="sm"
        />
      ) : null}
    </div>
  );
}
