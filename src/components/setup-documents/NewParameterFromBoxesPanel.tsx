"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnchoredMenu } from "@/components/ui/AnchoredMenu";
import { CardPanel } from "@/components/ui/CardPanel";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Eyebrow } from "@/components/ui/panel";
import { suggestKeyFromPdfFieldName } from "@/lib/setupCalibrations/customFieldCatalog";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";
import { parameterNameSuggestions } from "@/lib/setupSheetModels/parameterNameSuggestions";
import {
  UNIVERSAL_TOURING_PARAMETERS,
  lookupUniversalParameterDef,
} from "@/lib/setupSheetModels/universalParameters";
import {
  POSITION_LABELS,
  type NewParameterInput,
  type NewParameterKind,
  type PositionSplit,
} from "@/lib/setupSheetModels/newParameterDef";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { cn } from "@/lib/utils";

export type PendingBox = {
  /** `pdfFieldName#instanceIndex` */
  sourceKey: string;
  pdfFieldName: string;
  instanceIndex: number;
  /** Parameters that already own this box — mapping it here takes it off them. */
  conflictLabels: string[];
};

const SPLIT_CHIPS: ReadonlyArray<readonly [PositionSplit, string]> = [
  ["single", "Single"],
  ["front_rear", "Front/Rear"],
  ["corner4", "FF/FR/RF/RR"],
];

/**
 * Box-first parameter creation: the driver clicks a box on the sheet and names it here. The panel
 * stays open while more are added, so a row of checkboxes becomes one grouped parameter, one
 * option per box in click order.
 *
 * Positions turn one typed stem into several parameters instead — "Camber" + Front/Rear becomes
 * `camber_front` and `camber_rear`, one box each, so the position is never typed. `boxes` is then
 * slot-addressed (one entry per position, `null` until its box is clicked) rather than a dense
 * click list.
 */
export function NewParameterFromBoxesPanel(props: {
  boxes: (PendingBox | null)[];
  split: PositionSplit;
  onSplitChange: (split: PositionSplit) => void;
  /** Read for name suggestions — stems already on this sheet come first. */
  schema: Pick<SetupSheetModelSchema, "fields">;
  /** Group names already used on this sheet — one-tap chips. */
  groupTitles: string[];
  busy: boolean;
  error: string | null;
  onRemoveBox: (slotIndex: number) => void;
  onHoverBox: (sourceKey: string | null) => void;
  onCancel: () => void;
  onSubmit: (input: NewParameterInput) => void;
}) {
  const { boxes, split, schema, groupTitles, busy, error } = props;
  const splitActive = split !== "single";
  const slotLabels = POSITION_LABELS[split];
  const filledBoxes = useMemo(
    () => boxes.filter((b): b is PendingBox => b !== null),
    [boxes]
  );
  /** Grouped (one parameter, these boxes are its options) is the single-position meaning only. */
  const grouped = !splitActive && filledBoxes.length > 1;
  const nextEmptySlot = boxes.findIndex((b) => b === null);

  const [displayLabel, setDisplayLabel] = useState("");
  const [groupTitle, setGroupTitle] = useState(groupTitles[0] ?? "");
  const [valueKind, setValueKind] = useState<"number" | "text">("number");
  const [groupKind, setGroupKind] = useState<"one_of_many" | "many_of_many">("one_of_many");
  const [optionLabelBySourceKey, setOptionLabelBySourceKey] = useState<Record<string, string>>({});
  const [universalId, setUniversalId] = useState<string | null>(null);
  const [universalTouched, setUniversalTouched] = useState(false);

  const nameRef = useRef<HTMLInputElement | null>(null);
  const [nameMenuOpen, setNameMenuOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  const suggestions = useMemo(
    () => parameterNameSuggestions(schema, displayLabel),
    [schema, displayLabel]
  );

  const suggestedUniversalId = useMemo(() => {
    const trimmed = displayLabel.trim();
    if (!trimmed || grouped || splitActive) return undefined;
    return suggestUniversalParameterId(suggestKeyFromPdfFieldName(trimmed), trimmed);
  }, [displayLabel, grouped, splitActive]);

  // Follow the suggestion until he picks one himself — a wrong universal id pollutes cross-car stats,
  // so it stays visible and clearable rather than silently applied.
  useEffect(() => {
    if (universalTouched) return;
    setUniversalId(suggestedUniversalId ?? null);
  }, [suggestedUniversalId, universalTouched]);

  /** What a Front/Rear split will pool stats as — the ids are derived per generated label. */
  const splitUniversalLabels = useMemo(() => {
    if (split !== "front_rear") return [];
    const stem = displayLabel.trim();
    if (!stem) return [];
    return POSITION_LABELS.front_rear
      .map((position) => {
        const label = `${stem} (${position})`;
        const id = suggestUniversalParameterId(suggestKeyFromPdfFieldName(label), label);
        return id ? lookupUniversalParameterDef(id)?.label ?? id : null;
      })
      .filter((l): l is string => l !== null);
  }, [split, displayLabel]);

  const kind: NewParameterKind = grouped ? groupKind : valueKind;

  function pickSuggestion(index: number) {
    const s = suggestions[index];
    if (!s) return;
    setDisplayLabel(s.stem);
    setNameMenuOpen(false);
    setActiveSuggestion(-1);
    if (s.suggestedSplit !== "single") props.onSplitChange(s.suggestedSplit);
    nameRef.current?.focus();
  }

  function onNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setNameMenuOpen(false);
      return;
    }
    if (!nameMenuOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeSuggestion >= 0) {
      e.preventDefault();
      pickSuggestion(activeSuggestion);
    }
  }

  function submit() {
    if (busy) return;
    props.onSubmit({
      displayLabel,
      groupTitle,
      kind,
      optionLabels: grouped
        ? filledBoxes.map((b) => optionLabelBySourceKey[b.sourceKey] ?? "")
        : undefined,
      // A split derives one id per generated position; a single parameter uses the picked one.
      universalParameterId: splitActive ? undefined : universalId ?? undefined,
    });
  }

  const conflicts = filledBoxes.flatMap((b) => b.conflictLabels);
  const partial = splitActive && filledBoxes.length < slotLabels.length;

  return (
    <CardPanel className="border-accent/60 bg-accent/10" contentClassName="space-y-3 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow>New parameter</Eyebrow>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {splitActive
              ? `${filledBoxes.length} of ${slotLabels.length} positions mapped — click the sheet to fill the next.`
              : grouped
                ? `${filledBoxes.length} boxes — label each one, they become the options.`
                : "Keep clicking boxes on the sheet to turn this into a group."}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
          onClick={props.onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>

      <div className="space-y-1">
        <label className="block text-muted-foreground" htmlFor="new-param-name">
          Name
        </label>
        <input
          id="new-param-name"
          ref={nameRef}
          className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          value={displayLabel}
          onChange={(e) => {
            setDisplayLabel(e.target.value);
            setActiveSuggestion(-1);
            setNameMenuOpen(true);
          }}
          onFocus={() => setNameMenuOpen(true)}
          // Delayed so a click on a suggestion lands before the menu unmounts.
          onBlur={() => window.setTimeout(() => setNameMenuOpen(false), 180)}
          onKeyDown={onNameKeyDown}
          placeholder={splitActive ? "e.g. Camber" : "e.g. Front upper arm"}
          autoComplete="off"
          role="combobox"
          aria-expanded={nameMenuOpen && suggestions.length > 0}
          aria-controls="new-param-name-suggestions"
          aria-activedescendant={
            activeSuggestion >= 0 ? `new-param-name-option-${activeSuggestion}` : undefined
          }
          autoFocus
        />
        <AnchoredMenu
          open={nameMenuOpen && suggestions.length > 0}
          anchorRef={nameRef}
          onClose={() => setNameMenuOpen(false)}
        >
          <ul
            id="new-param-name-suggestions"
            role="listbox"
            className="max-h-48 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-lg"
          >
            {suggestions.map((s, i) => (
              <li key={`${s.source}:${s.stem}`} role="option" aria-selected={i === activeSuggestion}>
                <button
                  id={`new-param-name-option-${i}`}
                  type="button"
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-2 py-1 text-left",
                    i === activeSuggestion ? "bg-muted" : "hover:bg-muted"
                  )}
                  // Beat the input's blur so the pick isn't lost to the menu unmounting.
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    pickSuggestion(i);
                  }}
                  onMouseEnter={() => setActiveSuggestion(i)}
                >
                  <span className="text-xs font-medium text-foreground">{s.stem}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {s.existingPositions.length > 0
                      ? `${s.existingPositions.join(", ")} already on this sheet`
                      : s.suggestedSplit === "front_rear"
                        ? "Universal — Front/Rear"
                        : "On this sheet"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </AnchoredMenu>
      </div>

      <div className="space-y-1">
        <div className="text-muted-foreground">Positions</div>
        <div className="flex flex-wrap gap-1">
          {SPLIT_CHIPS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cn(chipToggleClass(split === value), "px-2 py-1 text-[10px]")}
              onClick={() => props.onSplitChange(value)}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>
        {splitActive ? (
          <p className="text-[10px] text-muted-foreground">
            Creates {slotLabels.length} parameters —{" "}
            {slotLabels.map((p) => `${displayLabel.trim() || "Name"} (${p})`).join(", ")}.
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="text-muted-foreground">Group</div>
        <input
          className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          value={groupTitle}
          onChange={(e) => setGroupTitle(e.target.value)}
          placeholder="e.g. Front end"
        />
        {groupTitles.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {groupTitles.map((t) => (
              <button
                key={t}
                type="button"
                className={cn(
                  "rounded border px-2 py-0.5 text-[10px]",
                  t.toLowerCase() === groupTitle.trim().toLowerCase()
                    ? "border-accent/70 bg-accent/20 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
                onClick={() => setGroupTitle(t)}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="text-muted-foreground">Type</div>
        <div className="flex flex-wrap gap-1">
          {grouped
            ? (
                [
                  ["one_of_many", "One of many"],
                  ["many_of_many", "Many of many"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={cn(
                    "rounded border px-2 py-1 text-[10px]",
                    groupKind === k
                      ? "border-accent/60 bg-accent/15 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setGroupKind(k)}
                >
                  {label}
                </button>
              ))
            : (
                [
                  ["number", "Number"],
                  ["text", "Text"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={cn(
                    "rounded border px-2 py-1 text-[10px]",
                    valueKind === k
                      ? "border-accent/60 bg-accent/15 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setValueKind(k)}
                >
                  {label}
                </button>
              ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {splitActive ? "Boxes by position" : `Boxes (${filledBoxes.length})`}
          </span>
          <span className="text-[10px] text-muted-foreground">click the sheet to add</span>
        </div>
        <div className="space-y-1">
          {boxes.map((b, i) => (
            <div
              key={splitActive ? slotLabels[i] : (b?.sourceKey ?? i)}
              className={cn(
                "flex items-center gap-1.5 rounded border px-1.5 py-1",
                !b && i === nextEmptySlot
                  ? "border-accent/60 bg-accent/10"
                  : "border-border/60 bg-card"
              )}
              onMouseEnter={() => props.onHoverBox(b?.sourceKey ?? null)}
              onMouseLeave={() => props.onHoverBox(null)}
            >
              <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground">
                {splitActive ? slotLabels[i] : i + 1}
              </span>
              {!b ? (
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                  {i === nextEmptySlot ? "click the sheet →" : "empty"}
                </span>
              ) : grouped ? (
                <input
                  className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
                  value={optionLabelBySourceKey[b.sourceKey] ?? ""}
                  onChange={(e) =>
                    setOptionLabelBySourceKey((prev) => ({ ...prev, [b.sourceKey]: e.target.value }))
                  }
                  placeholder={`Option ${i + 1} (e.g. CFF)`}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                  {b.pdfFieldName}#{b.instanceIndex}
                </span>
              )}
              <button
                type="button"
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-40"
                onClick={() => props.onRemoveBox(i)}
                disabled={!b}
                aria-label={splitActive ? `Clear ${slotLabels[i]}` : "Remove this box"}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {conflicts.length > 0 ? (
          <p className="text-[10px] text-amber-300">
            Already mapped to {Array.from(new Set(conflicts)).join(", ")} — saving takes the box(es)
            off it.
          </p>
        ) : null}
        {partial ? (
          <p className="text-[10px] text-muted-foreground">
            All {slotLabels.length} parameters are still created — the unmapped ones show under
            “Unmapped” in the list.
          </p>
        ) : null}
      </div>

      {splitActive ? (
        <p className="text-[10px] text-muted-foreground">
          {splitUniversalLabels.length > 0
            ? `Pools stats as ${splitUniversalLabels.join(", ")}.`
            : split === "corner4"
              ? "Per-corner parameters stay out of cross-car stats."
              : "Not a universal parameter — no cross-car pooling."}
        </p>
      ) : (
        <div className="space-y-1">
          <div className="text-muted-foreground">
            Universal parameter{" "}
            <span className="text-[10px]">(optional — pools stats across cars)</span>
          </div>
          <select
            className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground"
            value={universalId ?? ""}
            onChange={(e) => {
              setUniversalTouched(true);
              setUniversalId(e.target.value || null);
            }}
          >
            <option value="">Not a universal parameter</option>
            {UNIVERSAL_TOURING_PARAMETERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {suggestedUniversalId && universalId !== suggestedUniversalId ? (
            <button
              type="button"
              className="rounded border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200"
              onClick={() => {
                setUniversalTouched(true);
                setUniversalId(suggestedUniversalId);
              }}
            >
              Use “{lookupUniversalParameterDef(suggestedUniversalId)?.label ?? suggestedUniversalId}”
            </button>
          ) : null}
        </div>
      )}

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded border border-accent/60 bg-accent/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={submit}
          disabled={busy || !displayLabel.trim() || filledBoxes.length === 0}
        >
          {busy
            ? "Adding…"
            : splitActive
              ? `Add & map ${filledBoxes.length} of ${slotLabels.length}`
              : grouped
                ? `Add & map ${filledBoxes.length} boxes`
                : "Add & map"}
        </button>
      </div>
    </CardPanel>
  );
}
