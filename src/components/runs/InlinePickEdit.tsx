"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PickerSheet } from "@/components/ui/PickerSheet";
import type { OptionSection } from "@/lib/search/optionSearch";

/**
 * A value on a logged run that is a CHOICE, changed in place.
 *
 * ============================== WHY NOT A TEXT BOX ==============================
 *
 * `InlineValueEdit` is right for a number the driver measured — a ride height, a
 * temperature. It is wrong for everything that names a row in a table: a car, an
 * event, a tire set, an additive, a session type. Typing "Set 4 · run 6" into a text
 * field does not select set 4; it invents a string that matches nothing, and the run
 * quietly stops belonging to the rubber it was on.
 *
 * So anything that resolves to an id gets this instead. Same affordance from the
 * driver's side — tap the value, change it — and no way to name something that does
 * not exist.
 *
 * ============================== WHY THE PICKER SHEET, NOT A NATIVE SELECT ==============================
 *
 * This was a bare `<select>` until 2026-08-24, on the app's "short list, native menu"
 * rule. That rule was wrong here for one measured reason: the tire list this thing is
 * handed is the whole catalog — `correction-options` serves up to 200 compounds. On an
 * iPhone a native `<select>` is a five-row wheel with no way to type, so correcting a
 * tire set meant spinning blind past your own rubber. That is precisely the complaint
 * `PickerSheet` exists to answer, and it answers it here identically: search, big rows,
 * a tick on what's already set, opened onto the current choice.
 *
 * The car and additive lists are short and would have been fine either way. They use
 * the sheet anyway, by founder call (2026-08-24) — pickers sitting side by side in one
 * grid that behave differently is the worse outcome. It costs them nothing: the sheet's
 * own threshold suppresses the search field under ten rows, so a short list gets a short
 * sheet that hugs its rows rather than 85% of the screen. The additive had its own
 * near-duplicate of this file (`InlineAdditiveEdit`); it is deleted, not wrapped.
 *
 * ============================== WHY THE CLOSED STATE DID NOT CHANGE ==============================
 *
 * `PickerTrigger` — the boxed control with a chevron the wizard uses — is deliberately
 * NOT used. A session view is a record you read, and a boxed control always looks
 * pressable. What opens on tap changed; what a run looks like did not.
 *
 * `disabled` still renders plain text with no underline and no hit target at all —
 * not a greyed-out control (founder call, 2026-08-20).
 */

export type InlinePickOption = {
  id: string;
  label: string;
  /** Heading to sit under. Options with no group land in one unlabelled list. */
  group?: string;
};

/** Groups in the order the server gave them; ungrouped options stay one flat section. */
function toSections(options: InlinePickOption[]): OptionSection[] {
  const sections: OptionSection[] = [];
  const byKey = new Map<string, OptionSection>();
  for (const o of options) {
    const key = o.group ?? "";
    let section = byKey.get(key);
    if (!section) {
      section = { key: key || "all", label: o.group ?? null, options: [] };
      byKey.set(key, section);
      sections.push(section);
    }
    section.options.push({ value: o.id, label: o.label });
  }
  return sections;
}

export function InlinePickEdit({
  value,
  valueId,
  options,
  loadOptions,
  ariaLabel,
  emptyLabel = "—",
  allowEmpty = false,
  disabled = false,
  align = "right",
  onSave,
  /**
   * Asked before anything is written, for a change that costs more than itself.
   * Resolving false abandons it and puts the old value back. The car uses this: moving
   * a run to another car takes its setup with it and changes what the diff compares
   * against, and the driver should be told that before it happens, not after.
   */
  confirm,
}: {
  /** What to show when closed. */
  value: string;
  /** The currently selected option, or null when nothing is set. */
  valueId: string | null;
  /** Ready-made options. Omit and pass `loadOptions` to fetch on first tap instead. */
  options?: InlinePickOption[];
  loadOptions?: () => Promise<InlinePickOption[]>;
  ariaLabel: string;
  emptyLabel?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  align?: "left" | "right";
  onSave: (nextId: string | null) => Promise<void>;
  confirm?: (next: InlinePickOption | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<InlinePickOption[] | null>(options ?? null);
  const [shown, setShown] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // The parent re-renders with the server's answer after a save, and with the original
  // value after a rollback. Either way the display follows it.
  useEffect(() => setShown(value), [value]);
  useEffect(() => {
    if (options) setLoaded(options);
  }, [options]);

  // Leaving edit mode with the sheet open would strand a picker over a read-only record.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open || loaded || !loadOptions) return;
    let alive = true;
    void loadOptions()
      .then((next) => {
        if (alive) setLoaded(next);
      })
      .catch(() => {
        if (!alive) return;
        // The list is the whole sheet. With nothing to show, close it and say so
        // where the driver was looking rather than parking an empty overlay.
        setOpen(false);
        setError("Couldn’t load the list");
      });
    return () => {
      alive = false;
    };
  }, [open, loaded, loadOptions]);

  const sections = useMemo(() => toSections(loaded ?? []), [loaded]);

  async function choose(rawNext: string) {
    const nextId = rawNext === "" ? null : rawNext;
    setOpen(false);
    if (nextId === valueId) return;
    const option = loaded?.find((o) => o.id === nextId) ?? null;
    if (confirm && !(await confirm(option))) return;

    const previous = shown;
    setShown(option?.label ?? emptyLabel);
    setError(null);
    try {
      await onSave(nextId);
    } catch (err) {
      setShown(previous);
      setError(err instanceof Error ? err.message : "Could not save that");
    }
  }

  if (disabled) {
    return (
      <span className={cn("text-[13px]", shown.trim() === "" && "text-muted-foreground")}>
        {shown.trim() === "" ? emptyLabel : shown}
      </span>
    );
  }

  const empty = shown.trim() === "" || shown === emptyLabel;

  return (
    <span className={cn("inline-flex flex-col gap-0.5", align === "right" ? "items-end" : "items-start")}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setError(null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${empty ? "not set" : shown}. Tap to change.`}
        className={cn(
          "tap-active -mx-1 rounded-md px-1 text-[13px] transition-colors",
          align === "right" ? "text-right" : "text-left",
          // Always underlined while edit mode is on — a hover-only underline is
          // invisible on a phone, and a column of em-dashes then reads as "nothing
          // recorded" rather than "tap me".
          "underline decoration-dotted decoration-muted-foreground/45 underline-offset-4 hover:bg-muted/60 hover:decoration-foreground",
          empty ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {empty ? emptyLabel : shown}
      </button>
      {error ? (
        <span role="alert" className="text-[11px] leading-tight text-destructive">
          {error}
        </span>
      ) : null}
      {/* First tap on a cold list waits on a request. Without this the tap reads as dead. */}
      {open && loaded == null ? (
        <span className="text-[11px] leading-tight text-muted-foreground">Loading…</span>
      ) : null}
      {/*
        Held back until the list is in hand. The sheet's own opening behaviour — scroll
        the current choice to the middle — is measured on first paint, so mounting it
        empty and filling it a moment later would open every picker at row one.
      */}
      <PickerSheet
        open={open && loaded != null}
        onClose={() => setOpen(false)}
        title={ariaLabel}
        value={valueId ?? ""}
        onSelect={(next) => void choose(next)}
        sections={sections}
        searchPlaceholder={`Search ${ariaLabel.toLowerCase()}…`}
        clearRow={allowEmpty ? { label: emptyLabel === "—" ? "None" : emptyLabel } : null}
      />
    </span>
  );
}
