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

export function isA800RRCar(template: string | null | undefined): boolean {
  return template === SETUP_SHEET_TEMPLATE_A800RR;
}

/** Short label for car lists and setup UX (“car type” for structured setup features). */
export function labelForSetupSheetTemplate(template: string | null | undefined): string {
  if (template === SETUP_SHEET_TEMPLATE_A800RR) return "Awesomatix A800RR";
  return "No setup template";
}
