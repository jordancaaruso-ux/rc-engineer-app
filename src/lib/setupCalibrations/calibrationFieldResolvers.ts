/**
 * Generic calibration value resolution helpers (pure; safe on client).
 * PDF extraction uses `resolveSingleSelectFormRule` in `pdfFormFields` (server) with the same semantics.
 */

import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";

export type SingleSelectResolution = {
  value: string | null;
  warning?: string;
};

/** Normalize outcome when single-select labels are already collected (e.g. tests / post-processing). */
export function resolveSingleSelectFromOnLabels(onLabels: string[]): SingleSelectResolution {
  if (onLabels.length === 0) return { value: null };
  if (onLabels.length > 1) {
    return {
      value: null,
      warning: `Multiple options on (${onLabels.join(", ")}); expected at most one.`,
    };
  }
  return { value: onLabels[0]! };
}

export function resolveBooleanFromCheckboxState(checked: boolean | undefined): boolean | null {
  if (checked === true) return true;
  if (checked === false) return false;
  return null;
}

export type PairedResolution<T> = { front: T | null; rear: T | null };

export function resolvePaired<T>(
  frontRule: PdfFormFieldMappingRule | undefined,
  rearRule: PdfFormFieldMappingRule | undefined,
  resolveSide: (rule: PdfFormFieldMappingRule | undefined) => T | null
): PairedResolution<T> {
  return {
    front: resolveSide(frontRule),
    rear: resolveSide(rearRule),
  };
}

export function resolveTextFromSimpleField(_rule: PdfFormFieldMappingRule | undefined, rawValue: string | undefined): string | null {
  const v = rawValue?.trim();
  return v ? v : null;
}

export function resolveNumberFromText(raw: string | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number.parseFloat(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
