/**
 * Car.setupSheetTemplate values. Used for gating which setup sheet view is available in Analysis.
 */
export const SETUP_SHEET_TEMPLATE_NONE: null = null;
export const SETUP_SHEET_TEMPLATE_A800RR = "awesomatix_a800rr" as const;

export type SetupSheetTemplateId = typeof SETUP_SHEET_TEMPLATE_A800RR | null;

export const SETUP_SHEET_TEMPLATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "None" },
  { value: SETUP_SHEET_TEMPLATE_A800RR, label: "Awesomatix A800RR" },
];

/**
 * Canonical value for `Car.setupSheetTemplate` and community aggregation keys.
 * Maps any casing of the A800RR id to `awesomatix_a800rr`; other non-empty strings return trimmed as-is.
 */
export function canonicalSetupSheetTemplateId(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  if (t.toLowerCase() === SETUP_SHEET_TEMPLATE_A800RR) return SETUP_SHEET_TEMPLATE_A800RR;
  return t;
}

export function isA800RRCar(template: string | null | undefined): boolean {
  return canonicalSetupSheetTemplateId(template ?? null) === SETUP_SHEET_TEMPLATE_A800RR;
}

/** Short label for car lists and setup UX (“car type” for structured setup features). */
export function labelForSetupSheetTemplate(template: string | null | undefined): string {
  if (canonicalSetupSheetTemplateId(template ?? null) === SETUP_SHEET_TEMPLATE_A800RR) return "Awesomatix A800RR";
  return "No setup template";
}
