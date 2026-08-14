"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { OptionRowsEditor } from "@/components/setup-sheet-models/OptionRowsEditor";
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
  suggestGroupTitleForLabel,
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

const SIMPLE_KIND_CHIPS: ReadonlyArray<readonly [NewParameterKind, string]> = [
  ["number", "Number"],
  ["text", "Text"],
  ["checkbox", "Yes/no"],
];

const GROUPED_KIND_CHIPS: ReadonlyArray<readonly [NewParameterKind, string]> = [
  ["one_of_many", "One of many"],
  ["many_of_many", "Many of many"],
];

function isGroupedKind(kind: NewParameterKind): boolean {
  return kind === "one_of_many" || kind === "many_of_many";
}

/**
 * Box-first parameter creation: the driver clicks a box on the sheet and names it here. The panel
 * stays open while more are added, so a row of checkboxes becomes one grouped parameter, one
 * option per box in click order.
 *
 * Positions turn one typed stem into several parameters instead — "Camber" + Front/Rear becomes
 * `camber_front` and `camber_rear`, so the position is never typed. A grouped kind on top of that
 * gives a positions × options grid: the same printed row of holes at the front and at the rear
 * becomes two independent pick-one parameters, and each position may carry its own option list
 * (front with 3 holes, rear with 4). `grid` is then rows (positions) × columns (option boxes)
 * rather than a dense click list.
 */
export function NewParameterFromBoxesPanel(props: {
  grid: (PendingBox | null)[][];
  split: PositionSplit;
  onSplitChange: (split: PositionSplit) => void;
  /** How many box slots each position needs — driven by its option list. Splits only. */
  onOptionCountsChange: (counts: number[]) => void;
  /** Read for name suggestions — stems already on this sheet come first. */
  schema: Pick<SetupSheetModelSchema, "fields">;
  /** Group names to offer as one-tap chips — the universal groups, plus this sheet's own. */
  groupTitles: string[];
  busy: boolean;
  error: string | null;
  onRemoveBox: (row: number, col: number) => void;
  onHoverBox: (sourceKey: string | null) => void;
  onCancel: () => void;
  onSubmit: (input: NewParameterInput, optionLabelsByPosition?: string[][]) => void;
}) {
  const { grid, split, schema, groupTitles, busy, error } = props;
  const splitActive = split !== "single";
  const positions = POSITION_LABELS[split];

  const [displayLabel, setDisplayLabel] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupTouched, setGroupTouched] = useState(false);
  const [valueKind, setValueKind] = useState<NewParameterKind>("number");
  const [groupKind, setGroupKind] = useState<NewParameterKind>("one_of_many");
  const [splitKind, setSplitKind] = useState<NewParameterKind>("number");
  const [optionLabelBySourceKey, setOptionLabelBySourceKey] = useState<Record<string, string>>({});
  /** Shared option list for every position — the common case where front and rear holes match. */
  const [sharedOptions, setSharedOptions] = useState<string[]>(["", ""]);
  /** Per-position override, by position index. Absent = follow {@link sharedOptions}. */
  const [optionsByPosition, setOptionsByPosition] = useState<Record<number, string[]>>({});
  const [universalId, setUniversalId] = useState<string | null>(null);
  const [universalTouched, setUniversalTouched] = useState(false);

  const nameRef = useRef<HTMLInputElement | null>(null);
  const [nameMenuOpen, setNameMenuOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  const singleRow = grid[0] ?? [];
  const filledBoxes = useMemo(() => grid.flat().filter((b): b is PendingBox => b !== null), [grid]);
  /** Grouped-by-click (one parameter, these boxes are its options) is the single-position meaning. */
  const clickGrouped = !splitActive && singleRow.filter(Boolean).length > 1;
  const splitGrouped = splitActive && isGroupedKind(splitKind);

  const kind: NewParameterKind = splitActive ? splitKind : clickGrouped ? groupKind : valueKind;

  const optionLabelsByPosition = useMemo(
    () => positions.map((_, i) => optionsByPosition[i] ?? sharedOptions),
    [positions, optionsByPosition, sharedOptions]
  );

  // Tell the editor how wide each position's row of box slots must be: one box per position for a
  // simple kind, one per option for a grouped one. Joined to a string so the effect compares by
  // value, and the editor no-ops an unchanged shape — between them this can't ping-pong.
  const countsKey = splitActive
    ? (splitGrouped ? optionLabelsByPosition.map((o) => o.length) : positions.map(() => 1)).join(",")
    : "";
  const onOptionCountsChange = props.onOptionCountsChange;
  useEffect(() => {
    if (!countsKey) return;
    onOptionCountsChange(countsKey.split(",").map((n) => Number.parseInt(n, 10)));
  }, [countsKey, onOptionCountsChange]);

  const suggestions = useMemo(
    () => parameterNameSuggestions(schema, displayLabel),
    [schema, displayLabel]
  );

  const suggestedUniversalId = useMemo(() => {
    const trimmed = displayLabel.trim();
    if (!trimmed || clickGrouped || splitActive) return undefined;
    return suggestUniversalParameterId(suggestKeyFromPdfFieldName(trimmed), trimmed);
  }, [displayLabel, clickGrouped, splitActive]);

  // Follow the suggestion until he picks one himself — a wrong universal id pollutes cross-car stats,
  // so it stays visible and clearable rather than silently applied.
  useEffect(() => {
    if (universalTouched) return;
    setUniversalId(suggestedUniversalId ?? null);
  }, [suggestedUniversalId, universalTouched]);

  // Pre-select the group the name implies ("Front spring" -> Shocks & springs), until he picks a
  // chip himself. A name that matches nothing leaves the field alone rather than guessing — the
  // chips are right there, and a silently wrong group is worse than an unset one.
  const suggestedGroupTitle = useMemo(
    () => suggestGroupTitleForLabel(displayLabel),
    [displayLabel]
  );
  useEffect(() => {
    if (groupTouched || !suggestedGroupTitle) return;
    setGroupTitle(suggestedGroupTitle);
  }, [suggestedGroupTitle, groupTouched]);

  /** What a Front/Rear split will pool stats as — the ids are derived per generated label. */
  const splitUniversalLabels = useMemo(() => {
    if (split !== "front_rear" || splitGrouped) return [];
    const stem = displayLabel.trim();
    if (!stem) return [];
    return POSITION_LABELS.front_rear
      .map((position) => {
        const label = `${stem} (${position})`;
        const id = suggestUniversalParameterId(suggestKeyFromPdfFieldName(label), label);
        return id ? lookupUniversalParameterDef(id)?.label ?? id : null;
      })
      .filter((l): l is string => l !== null);
  }, [split, splitGrouped, displayLabel]);

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
    props.onSubmit(
      {
        displayLabel,
        groupTitle,
        kind,
        optionLabels: clickGrouped
          ? singleRow.map((b) => (b ? optionLabelBySourceKey[b.sourceKey] ?? "" : ""))
          : undefined,
        // A split derives one id per generated position; a single parameter uses the picked one.
        universalParameterId: splitActive ? undefined : universalId ?? undefined,
      },
      splitGrouped ? optionLabelsByPosition.map((o) => [...o]) : undefined
    );
  }

  const conflicts = filledBoxes.flatMap((b) => b.conflictLabels);
  const totalSlots = grid.reduce((n, cells) => n + cells.length, 0);
  const partial = splitActive && filledBoxes.length < totalSlots;
  /** Row-major: the cell the next sheet click will fill. */
  const nextCell = useMemo(() => {
    for (const [row, cells] of grid.entries()) {
      for (const [col, box] of cells.entries()) {
        if (!box) return { row, col };
      }
    }
    return null;
  }, [grid]);

  return (
    <CardPanel className="border-primary-ink/60 bg-accent/10" contentClassName="space-y-3 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow>New parameter</Eyebrow>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {splitActive
              ? `${filledBoxes.length} of ${totalSlots} boxes mapped — click the sheet to fill the next.`
              : clickGrouped
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
            Creates {positions.length} parameters —{" "}
            {positions.map((p) => `${displayLabel.trim() || "Name"} (${p})`).join(", ")}.
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="text-muted-foreground">Group</div>
        <input
          className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          value={groupTitle}
          onChange={(e) => {
            setGroupTouched(true);
            setGroupTitle(e.target.value);
          }}
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
                    ? "border-primary-ink/70 bg-accent/20 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
                onClick={() => {
                  setGroupTouched(true);
                  setGroupTitle(t);
                }}
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
          {(splitActive
            ? [...SIMPLE_KIND_CHIPS, ...GROUPED_KIND_CHIPS]
            : clickGrouped
              ? GROUPED_KIND_CHIPS
              : SIMPLE_KIND_CHIPS
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={cn(chipToggleClass(kind === k), "px-2 py-1 text-[10px]")}
              onClick={() =>
                splitActive ? setSplitKind(k) : clickGrouped ? setGroupKind(k) : setValueKind(k)
              }
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {splitGrouped ? (
        <div className="space-y-2 rounded border border-border/60 bg-card/60 p-2">
          <div className="text-muted-foreground">
            Options <span className="text-[10px]">(same at every position unless you say so)</span>
          </div>
          <OptionRowsEditor
            options={sharedOptions}
            onChange={setSharedOptions}
            idPrefix="split-shared"
          />
          {positions.map((position, i) => {
            const overridden = optionsByPosition[i] != null;
            return (
              <div key={position} className="space-y-1 border-t border-border/60 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="tabular-nums text-[10px] text-muted-foreground">{position}</span>
                  <button
                    type="button"
                    className={cn(chipToggleClass(overridden), "px-2 py-0.5 text-[10px]")}
                    onClick={() =>
                      setOptionsByPosition((prev) => {
                        const next = { ...prev };
                        if (overridden) delete next[i];
                        else next[i] = [...sharedOptions];
                        return next;
                      })
                    }
                    disabled={busy}
                  >
                    {overridden ? "Using its own list" : "Different here"}
                  </button>
                </div>
                {overridden ? (
                  <OptionRowsEditor
                    options={optionsByPosition[i] ?? []}
                    onChange={(next) => setOptionsByPosition((prev) => ({ ...prev, [i]: next }))}
                    idPrefix={`split-${position}`}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {splitActive ? "Boxes by position" : `Boxes (${filledBoxes.length})`}
          </span>
          <span className="text-[10px] text-muted-foreground">click the sheet to add</span>
        </div>

        {splitActive ? (
          <div className="space-y-1">
            {grid.map((cells, row) => (
              <div key={positions[row] ?? row} className="flex items-stretch gap-1">
                <span className="w-10 shrink-0 self-center tabular-nums text-[10px] text-muted-foreground">
                  {positions[row] ?? row + 1}
                </span>
                {cells.map((box, col) => {
                  const isNext = nextCell?.row === row && nextCell?.col === col;
                  const optionLabel = splitGrouped
                    ? optionLabelsByPosition[row]?.[col]?.trim() || `${col + 1}`
                    : null;
                  return (
                    <button
                      key={col}
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 rounded border px-1.5 py-1 text-left text-[10px]",
                        box
                          ? "border-border/60 bg-card text-foreground"
                          : isNext
                            ? "border-primary-ink/60 bg-accent/10 text-muted-foreground"
                            : "border-dashed border-border/60 text-muted-foreground"
                      )}
                      onMouseEnter={() => props.onHoverBox(box?.sourceKey ?? null)}
                      onMouseLeave={() => props.onHoverBox(null)}
                      onClick={() => box && props.onRemoveBox(row, col)}
                      disabled={!box}
                      title={
                        box ? `${box.pdfFieldName}#${box.instanceIndex} — tap to clear` : undefined
                      }
                      aria-label={
                        box
                          ? `Clear ${positions[row] ?? ""} ${optionLabel ?? ""}`.trim()
                          : `${positions[row] ?? ""} ${optionLabel ?? ""} empty`.trim()
                      }
                    >
                      {optionLabel ? (
                        <span className="block truncate tabular-nums text-[9px] opacity-70">
                          {optionLabel}
                        </span>
                      ) : null}
                      <span className="block truncate">
                        {box ? `✓ ${box.pdfFieldName}` : isNext ? "click →" : "empty"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {singleRow.map((b, col) => (
              <div
                key={b?.sourceKey ?? col}
                className="flex items-center gap-1.5 rounded border border-border/60 bg-card px-1.5 py-1"
                onMouseEnter={() => props.onHoverBox(b?.sourceKey ?? null)}
                onMouseLeave={() => props.onHoverBox(null)}
              >
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {col + 1}
                </span>
                {b && clickGrouped ? (
                  <input
                    className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
                    value={optionLabelBySourceKey[b.sourceKey] ?? ""}
                    onChange={(e) =>
                      setOptionLabelBySourceKey((prev) => ({
                        ...prev,
                        [b.sourceKey]: e.target.value,
                      }))
                    }
                    placeholder={`Option ${col + 1} (e.g. CFF)`}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate tabular-nums text-[10px] text-muted-foreground">
                    {b ? `${b.pdfFieldName}#${b.instanceIndex}` : "empty"}
                  </span>
                )}
                <button
                  type="button"
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                  onClick={() => props.onRemoveBox(0, col)}
                  aria-label="Remove this box"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {conflicts.length > 0 ? (
          <p className="text-[10px] text-amber-300">
            Already mapped to {Array.from(new Set(conflicts)).join(", ")} — saving takes the box(es)
            off it.
          </p>
        ) : null}
        {partial ? (
          <p className="text-[10px] text-muted-foreground">
            All {positions.length} parameters are still created. A choice position needs 2 boxes to
            map at all — anything short shows under “Unmapped” in the list.
          </p>
        ) : null}
      </div>

      {splitActive ? (
        <p className="text-[10px] text-muted-foreground">
          {splitGrouped
            ? "Choice parameters stay out of cross-car stats."
            : splitUniversalLabels.length > 0
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
          className="flex-1 rounded border border-primary-ink/60 bg-accent/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={submit}
          disabled={busy || !displayLabel.trim() || filledBoxes.length === 0}
        >
          {busy
            ? "Adding…"
            : splitActive
              ? `Add & map ${filledBoxes.length} of ${totalSlots}`
              : clickGrouped
                ? `Add & map ${filledBoxes.length} boxes`
                : "Add & map"}
        </button>
      </div>
    </CardPanel>
  );
}
