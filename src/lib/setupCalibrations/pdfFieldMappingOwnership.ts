/**
 * Single source of truth for which calibration canonical key "owns" a PDF AcroForm widget
 * (field name + instance index). Used for conflict detection and safe detach before reassignment.
 */

import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";

/** Minimal row shape for ownership checks (matches SetupCalibrationEditorClient PdfFormFieldRow). */
export type PdfFieldRowForOwnership = {
  name: string;
  type: string;
  widgets?: Array<{ instanceIndex?: number }>;
};

export function isToggleFieldType(t: string): boolean {
  return t === "CheckBox" || t === "RadioGroup";
}

export function ruleReferencesWidget(
  rule: PdfFormFieldMappingRule,
  pdfFieldName: string,
  instanceIndex: number,
  row: PdfFieldRowForOwnership | undefined
): boolean {
  if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
    for (const ref of Object.values(rule.options)) {
      if (ref.pdfFieldName !== pdfFieldName) continue;
      const n = row?.widgets?.length ?? 0;
      if (ref.widgetInstanceIndex != null) {
        if (ref.widgetInstanceIndex === instanceIndex) return true;
      } else if (n <= 1) {
        if (instanceIndex === 0) return true;
      }
    }
    return false;
  }
  if ("mode" in rule && (rule.mode === "singleChoiceWidgetGroup" || rule.mode === "multiSelectWidgetGroup")) {
    if (rule.pdfFieldName !== pdfFieldName) return false;
    for (const opt of Object.values(rule.options)) {
      if (opt.widgetInstanceIndex === instanceIndex) return true;
    }
    return false;
  }
  const simple = rule as { pdfFieldName: string; widgetInstanceIndex?: number };
  if (simple.pdfFieldName !== pdfFieldName) return false;
  const n = row?.widgets?.length ?? 0;
  const toggle = row && isToggleFieldType(row.type);
  if (toggle && n > 1) {
    return simple.widgetInstanceIndex === instanceIndex;
  }
  if (simple.widgetInstanceIndex != null) return simple.widgetInstanceIndex === instanceIndex;
  return instanceIndex === 0 || n <= 1;
}

export function findAppKeysForWidget(
  mappings: Record<string, PdfFormFieldMappingRule>,
  pdfFieldName: string,
  instanceIndex: number,
  row: PdfFieldRowForOwnership | undefined
): string[] {
  const keys: string[] = [];
  for (const [appKey, rule] of Object.entries(mappings)) {
    if (ruleReferencesWidget(rule, pdfFieldName, instanceIndex, row)) keys.push(appKey);
  }
  return keys;
}

export type PdfWidgetOwnershipDetail = {
  canonicalKey: string;
  /** Stored option value when this widget is one option in a group; undefined for simple rules. */
  optionValue?: string;
  /** Short description for UI, e.g. `option "technical"` or `whole field`. */
  context: string;
};

function describeRuleHit(
  appKey: string,
  rule: PdfFormFieldMappingRule,
  pdfFieldName: string,
  instanceIndex: number,
  row: PdfFieldRowForOwnership | undefined
): PdfWidgetOwnershipDetail | null {
  if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
    for (const [valueKey, ref] of Object.entries(rule.options)) {
      if (ref.pdfFieldName !== pdfFieldName) continue;
      const n = row?.widgets?.length ?? 0;
      const match =
        ref.widgetInstanceIndex != null
          ? ref.widgetInstanceIndex === instanceIndex
          : n <= 1 && instanceIndex === 0;
      if (match) {
        return {
          canonicalKey: appKey,
          optionValue: valueKey,
          context: `option "${valueKey}"`,
        };
      }
    }
    return null;
  }
  if ("mode" in rule && (rule.mode === "singleChoiceWidgetGroup" || rule.mode === "multiSelectWidgetGroup")) {
    if (rule.pdfFieldName !== pdfFieldName) return null;
    for (const [valueKey, ref] of Object.entries(rule.options)) {
      if (ref.widgetInstanceIndex === instanceIndex) {
        return {
          canonicalKey: appKey,
          optionValue: valueKey,
          context: `option "${valueKey}"`,
        };
      }
    }
    return null;
  }
  if (ruleReferencesWidget(rule, pdfFieldName, instanceIndex, row)) {
    return { canonicalKey: appKey, context: "whole field" };
  }
  return null;
}

/**
 * All uses of this PDF widget in the current form mappings (one row per app key hit; grouped fields include option).
 */
export function listPdfWidgetOwnershipDetails(
  mappings: Record<string, PdfFormFieldMappingRule>,
  pdfFieldName: string,
  instanceIndex: number,
  row: PdfFieldRowForOwnership | undefined
): PdfWidgetOwnershipDetail[] {
  const appKeys = findAppKeysForWidget(mappings, pdfFieldName, instanceIndex, row);
  const out: PdfWidgetOwnershipDetail[] = [];
  for (const appKey of appKeys) {
    const rule = mappings[appKey];
    if (!rule) continue;
    const d = describeRuleHit(appKey, rule, pdfFieldName, instanceIndex, row);
    if (d) out.push(d);
  }
  return out;
}

/**
 * Owners on *other* calibration fields (different canonical key). Same-key edits do not require overwrite confirmation.
 */
export function filterCrossFieldConflicts(
  owners: PdfWidgetOwnershipDetail[],
  targetCanonicalKey: string
): PdfWidgetOwnershipDetail[] {
  return owners.filter((o) => o.canonicalKey !== targetCanonicalKey);
}

/**
 * Removes every reference to this widget from mappings (grouped rules lose that option; empty rules deleted).
 */
export function removePdfWidgetFromMappings(
  mappings: Record<string, PdfFormFieldMappingRule>,
  pdfFieldName: string,
  instanceIndex: number,
  row: PdfFieldRowForOwnership | undefined
): Record<string, PdfFormFieldMappingRule> {
  const next: Record<string, PdfFormFieldMappingRule> = { ...mappings };

  for (const [appKey, rule] of Object.entries(mappings)) {
    if ("mode" in rule && rule.mode === "singleChoiceWidgetGroup") {
      if (rule.pdfFieldName !== pdfFieldName) continue;
      const opts = { ...rule.options };
      for (const [label, ref] of Object.entries(rule.options)) {
        if (ref.widgetInstanceIndex === instanceIndex) delete opts[label];
      }
      if (Object.keys(opts).length === 0) delete next[appKey];
      else next[appKey] = { ...rule, options: opts };
      continue;
    }
    if ("mode" in rule && rule.mode === "multiSelectWidgetGroup") {
      if (rule.pdfFieldName !== pdfFieldName) continue;
      const opts = { ...rule.options };
      for (const [label, ref] of Object.entries(rule.options)) {
        if (ref.widgetInstanceIndex === instanceIndex) delete opts[label];
      }
      if (Object.keys(opts).length === 0) delete next[appKey];
      else next[appKey] = { ...rule, options: opts };
      continue;
    }
    if ("mode" in rule && (rule.mode === "singleChoiceNamedFields" || rule.mode === "multiSelectNamedFields")) {
      const opts = { ...rule.options };
      for (const [label, ref] of Object.entries(rule.options)) {
        if (ref.pdfFieldName !== pdfFieldName) continue;
        const n = row?.widgets?.length ?? 0;
        const match =
          ref.widgetInstanceIndex != null
            ? ref.widgetInstanceIndex === instanceIndex
            : n <= 1 && instanceIndex === 0;
        if (match) delete opts[label];
      }
      if (Object.keys(opts).length === 0) delete next[appKey];
      else next[appKey] = { ...rule, options: opts } as PdfFormFieldMappingRule;
      continue;
    }
    if (ruleReferencesWidget(rule, pdfFieldName, instanceIndex, row)) {
      delete next[appKey];
    }
  }

  return next;
}
