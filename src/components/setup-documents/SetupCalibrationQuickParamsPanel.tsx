"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { CustomSetupFieldDefinition } from "@/lib/setupCalibrations/types";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { CUSTOM_FIELD_SECTION_PRESETS } from "@/lib/setupCalibrations/customFieldCatalog";
import { customFieldGroupedChipContext } from "@/lib/setupCalibrations/customFieldGroupedChips";
import type { QuickCalibrationFieldKind } from "@/lib/setupCalibrations/quickCalibrationField";

export type AcroSelectOption = { value: string; label: string };

function parseAcroSelectValue(v: string): { pdfFieldName: string; instanceIndex: number } {
  const hash = v.lastIndexOf("#");
  if (hash <= 0) return { pdfFieldName: v.trim(), instanceIndex: 0 };
  return {
    pdfFieldName: v.slice(0, hash).trim(),
    instanceIndex: Number(v.slice(hash + 1)) || 0,
  };
}

function ruleHasFormMapping(rule: PdfFormFieldMappingRule | undefined): boolean {
  if (!rule) return false;
  if ("mode" in rule && rule.mode === "singleChoiceNamedFields") {
    return Object.keys(rule.options ?? {}).length > 0;
  }
  if ("mode" in rule && rule.mode === "multiSelectNamedFields") {
    return Object.keys(rule.options ?? {}).length > 0;
  }
  if ("mode" in rule && (rule.mode === "singleChoiceWidgetGroup" || rule.mode === "multiSelectWidgetGroup")) {
    return Object.keys(rule.options ?? {}).length > 0;
  }
  if (!("mode" in rule) || !rule.mode) {
    return Boolean((rule as { pdfFieldName?: string }).pdfFieldName?.trim());
  }
  return false;
}

export function SetupCalibrationQuickParamsPanel(props: {
  pdfFormRowsCount: number;
  acroSelectOptions: AcroSelectOption[];
  customFieldDefinitions: CustomSetupFieldDefinition[];
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  /** Add a custom field from the simplified form (no PDF mapping yet for grouped; simple may map in same step). */
  onQuickAdd: (input: {
    displayLabel: string;
    key: string;
    kind: QuickCalibrationFieldKind;
    optionLines: string;
    sectionId: string;
  }) => { ok: true } | { ok: false; error: string };
  /** Map a simple (non-grouped) custom field to one Acro widget. */
  onAssignSimple: (canonicalKey: string, pdfFieldName: string, instanceIndex: number) => void;
  /** Map one option of a grouped custom field. */
  onAssignGroupOption: (
    canonicalKey: string,
    optionValue: string,
    pdfFieldName: string,
    instanceIndex: number
  ) => void;
}) {
  const {
    pdfFormRowsCount,
    acroSelectOptions,
    customFieldDefinitions,
    formFieldMappings,
    onQuickAdd,
    onAssignSimple,
    onAssignGroupOption,
  } = props;

  const [open, setOpen] = useState(true);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<QuickCalibrationFieldKind>("number");
  const [optionLines, setOptionLines] = useState("");
  const [sectionId, setSectionId] = useState("tuning");
  const [localError, setLocalError] = useState<string | null>(null);

  const customOnly = useMemo(() => customFieldDefinitions, [customFieldDefinitions]);

  const sectionChoices = useMemo(() => {
    const m = new Map(CUSTOM_FIELD_SECTION_PRESETS.map((p) => [p.id, p.title] as const));
    for (const c of customFieldDefinitions) {
      if (c.sectionId && !m.has(c.sectionId)) m.set(c.sectionId, c.sectionTitle || c.sectionId);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [customFieldDefinitions]);

  const groupedCtx = (def: CustomSetupFieldDefinition) => customFieldGroupedChipContext(def);

  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <div className="ui-title text-xs text-sky-200/95">Quick add parameters</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Name the field, pick a value type, add it — then map each row to an AcroForm control (dropdown or use the
            Form tab and click the PDF).
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">{open ? "▼" : "▶"}</span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <span className="ui-title text-[10px] text-foreground/90">Parameter label</span>
              <input
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Front ride height"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <span className="ui-title text-[10px] text-foreground/90">Internal key (snake_case)</span>
              <input
                className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="auto-filled from label if empty"
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <span className="ui-title text-[10px] text-foreground/90">Value type</span>
              <select
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                value={kind}
                onChange={(e) => setKind(e.target.value as QuickCalibrationFieldKind)}
              >
                <option value="number">Number (text box on sheet)</option>
                <option value="text">Text</option>
                <option value="checkbox">Checkbox (on/off)</option>
                <option value="one_of_many">One of many (pick one option)</option>
                <option value="many_of_many">Many of many (any subset of options)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <span className="ui-title text-[10px] text-foreground/90">Section</span>
              <select
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
              >
                {sectionChoices.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {(kind === "one_of_many" || kind === "many_of_many") && (
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <span className="ui-title text-[10px] text-foreground/90">Option labels (one per line, at least 2)</span>
              <textarea
                className="min-h-[4.5rem] rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs"
                value={optionLines}
                onChange={(e) => setOptionLines(e.target.value)}
                placeholder={"Screw A\nScrew B\nScrew C"}
              />
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-sky-500/60 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-100 hover:bg-sky-500/25"
              onClick={() => {
                setLocalError(null);
                const lines =
                  kind === "one_of_many" || kind === "many_of_many"
                    ? optionLines.split(/\r?\n/).map((l) => l.trim())
                    : [];
                const res = onQuickAdd({
                  displayLabel: label.trim(),
                  key: key.trim(),
                  kind,
                  optionLines: lines.join("\n"),
                  sectionId,
                });
                if (!res.ok) {
                  setLocalError(res.error);
                  return;
                }
                setLabel("");
                setKey("");
                setOptionLines("");
                setKind("number");
              }}
            >
              Add parameter
            </button>
            {pdfFormRowsCount === 0 ? (
              <span className="text-[11px] text-amber-200/90">Link an example PDF to list AcroForm fields.</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">{acroSelectOptions.length} Acro widgets</span>
            )}
          </div>

          {localError ? <div className="text-[11px] text-red-300/95">{localError}</div> : null}

          {customOnly.length > 0 ? (
            <div className="space-y-2">
              <div className="ui-title text-[10px] text-muted-foreground">Your custom parameters</div>
              <ul className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border/70 bg-card/40 p-2">
                {customOnly.map((def) => {
                  const mapped = ruleHasFormMapping(formFieldMappings[def.key]);
                  const g = groupedCtx(def);
                  return (
                    <li
                      key={def.id}
                      className={cn(
                        "rounded border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px]",
                        !mapped && "border-amber-500/30"
                      )}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-foreground">{def.displayLabel}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{def.key}</span>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {def.valueType} · {def.uiType}
                        {def.groupBehaviorType ? ` · ${def.groupBehaviorType}` : ""}
                        {mapped ? (
                          <span className="ml-2 text-emerald-300/90">mapped</span>
                        ) : (
                          <span className="ml-2 text-amber-200/90">needs PDF link</span>
                        )}
                      </div>

                      {!g ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            className="max-w-full flex-1 rounded border border-border bg-card px-1.5 py-1 font-mono text-[10px]"
                            defaultValue=""
                            onChange={(e) => {
                              const v = e.target.value;
                              e.target.value = "";
                              if (!v) return;
                              const { pdfFieldName, instanceIndex } = parseAcroSelectValue(v);
                              onAssignSimple(def.key, pdfFieldName, instanceIndex);
                            }}
                          >
                            <option value="">Assign Acro widget…</option>
                            {acroSelectOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="mt-2 space-y-1.5">
                          {g.entries.map((entry) => (
                            <div key={entry.value} className="flex flex-wrap items-center gap-2">
                              <span
                                className="w-24 shrink-0 truncate text-[10px] text-muted-foreground"
                                title={entry.label}
                              >
                                {entry.label}
                              </span>
                              <select
                                className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-1 font-mono text-[10px]"
                                defaultValue=""
                                onChange={(e) => {
                                  const v = e.target.value;
                                  e.target.value = "";
                                  if (!v) return;
                                  const { pdfFieldName, instanceIndex } = parseAcroSelectValue(v);
                                  onAssignGroupOption(def.key, entry.value, pdfFieldName, instanceIndex);
                                }}
                              >
                                <option value="">Widget…</option>
                                {acroSelectOptions.map((o) => (
                                  <option key={`${entry.value}-${o.value}`} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
