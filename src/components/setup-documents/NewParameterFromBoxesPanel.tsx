"use client";

import { useEffect, useMemo, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { suggestKeyFromPdfFieldName } from "@/lib/setupCalibrations/customFieldCatalog";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";
import {
  UNIVERSAL_TOURING_PARAMETERS,
  lookupUniversalParameterDef,
} from "@/lib/setupSheetModels/universalParameters";
import type { NewParameterInput, NewParameterKind } from "@/lib/setupSheetModels/newParameterDef";
import { cn } from "@/lib/utils";

export type PendingBox = {
  /** `pdfFieldName#instanceIndex` */
  sourceKey: string;
  pdfFieldName: string;
  instanceIndex: number;
  /** Parameters that already own this box — mapping it here takes it off them. */
  conflictLabels: string[];
};

/**
 * Box-first parameter creation: the driver clicks a box on the sheet and names it here. The panel
 * stays open while he clicks more boxes — a row of checkboxes becomes one grouped parameter, one
 * option per box in click order.
 */
export function NewParameterFromBoxesPanel(props: {
  boxes: PendingBox[];
  /** Group names already used on this sheet — one-tap chips. */
  groupTitles: string[];
  busy: boolean;
  error: string | null;
  onRemoveBox: (sourceKey: string) => void;
  onHoverBox: (sourceKey: string | null) => void;
  onCancel: () => void;
  onSubmit: (input: NewParameterInput) => void;
}) {
  const { boxes, groupTitles, busy, error } = props;
  const grouped = boxes.length > 1;

  const [displayLabel, setDisplayLabel] = useState("");
  const [groupTitle, setGroupTitle] = useState(groupTitles[0] ?? "");
  const [valueKind, setValueKind] = useState<"number" | "text">("number");
  const [groupKind, setGroupKind] = useState<"one_of_many" | "many_of_many">("one_of_many");
  const [optionLabelBySourceKey, setOptionLabelBySourceKey] = useState<Record<string, string>>({});
  const [universalId, setUniversalId] = useState<string | null>(null);
  const [universalTouched, setUniversalTouched] = useState(false);

  const suggestedUniversalId = useMemo(() => {
    const trimmed = displayLabel.trim();
    if (!trimmed || grouped) return undefined;
    return suggestUniversalParameterId(suggestKeyFromPdfFieldName(trimmed), trimmed);
  }, [displayLabel, grouped]);

  // Follow the suggestion until he picks one himself — a wrong universal id pollutes cross-car stats,
  // so it stays visible and clearable rather than silently applied.
  useEffect(() => {
    if (universalTouched) return;
    setUniversalId(suggestedUniversalId ?? null);
  }, [suggestedUniversalId, universalTouched]);

  const kind: NewParameterKind = grouped ? groupKind : valueKind;

  function submit() {
    if (busy) return;
    props.onSubmit({
      displayLabel,
      groupTitle,
      kind,
      optionLabels: grouped ? boxes.map((b) => optionLabelBySourceKey[b.sourceKey] ?? "") : undefined,
      universalParameterId: universalId ?? undefined,
    });
  }

  const conflicts = boxes.flatMap((b) => b.conflictLabels);

  return (
    <CardPanel className="border-accent/60 bg-accent/10" contentClassName="space-y-3 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow>New parameter</Eyebrow>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {grouped
              ? `${boxes.length} boxes — label each one, they become the options.`
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

      <label className="block text-muted-foreground">
        Name
        <input
          className="mt-1 w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          value={displayLabel}
          onChange={(e) => setDisplayLabel(e.target.value)}
          placeholder="e.g. Front upper arm"
          autoFocus
        />
      </label>

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
          <span className="text-muted-foreground">Boxes ({boxes.length})</span>
          <span className="text-[10px] text-muted-foreground">click the sheet to add</span>
        </div>
        <div className="space-y-1">
          {boxes.map((b, i) => (
            <div
              key={b.sourceKey}
              className="flex items-center gap-1.5 rounded border border-border/60 bg-card px-1.5 py-1"
              onMouseEnter={() => props.onHoverBox(b.sourceKey)}
              onMouseLeave={() => props.onHoverBox(null)}
            >
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              {grouped ? (
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
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                onClick={() => props.onRemoveBox(b.sourceKey)}
                aria-label="Remove this box"
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
      </div>

      <div className="space-y-1">
        <div className="text-muted-foreground">
          Universal parameter <span className="text-[10px]">(optional — pools stats across cars)</span>
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

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded border border-accent/60 bg-accent/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={submit}
          disabled={busy || !displayLabel.trim() || boxes.length === 0}
        >
          {busy ? "Adding…" : grouped ? `Add & map ${boxes.length} boxes` : "Add & map"}
        </button>
      </div>
    </CardPanel>
  );
}
