/**
 * Car.setupSheetTemplate values. Used for gating which setup sheet view is available in Analysis.
 */
export const SETUP_SHEET_TEMPLATE_NONE: null = null;
export const SETUP_SHEET_TEMPLATE_A800RR = "awesomatix_a800rr" as const;

/** `SetupSheetModel.slug` for the built-in A800RR model (same value as {@link SETUP_SHEET_TEMPLATE_A800RR}). */
export const SETUP_SHEET_MODEL_SLUG_A800RR = SETUP_SHEET_TEMPLATE_A800RR;

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

/**
 * Canonical `setupSheetTemplate` key for a setup sheet model: the model slug. Community
 * aggregations, manufacturer baselines, and compare views all bucket by this key. For the A800RR
 * the slug equals the historical template string, so existing data keys are unchanged.
 */
export function templateKeyFromModelSlug(slug: string): string {
  if (slug === SETUP_SHEET_MODEL_SLUG_A800RR) return SETUP_SHEET_TEMPLATE_A800RR;
  return slug;
}

export function isA800RRCar(template: string | null | undefined): boolean {
  return canonicalSetupSheetTemplateId(template ?? null) === SETUP_SHEET_TEMPLATE_A800RR;
}

/**
 * Show the legacy A800 template picker? Only for a car with no chassis type of its own.
 *
 * Lived on `CarSetupSheetModelCard` until that card was removed on 2026-08-11; it has nothing to do
 * with the card and everything to do with the template ids in this module, so it moved here rather
 * than keeping a component file alive for one exported function.
 */
export function showLegacySetupSheetTemplateEdit(
  setupSheetModelId: string | null | undefined,
  setupSheetTemplate: string | null | undefined
): boolean {
  if (setupSheetModelId) return false;
  return isA800RRCar(setupSheetTemplate) || !setupSheetTemplate;
}

/** Short label for car lists and setup UX (“car type” for structured setup features). */
export function labelForSetupSheetTemplate(template: string | null | undefined): string {
  const canonical = canonicalSetupSheetTemplateId(template ?? null);
  if (canonical === SETUP_SHEET_TEMPLATE_A800RR) return "Awesomatix A800RR";
  if (!canonical) return "No setup template";
  // Template keys are model slugs (e.g. mugen_mtc3) — prettify for display.
  return canonical
    .split("_")
    .filter(Boolean)
    .map((part) => (/\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}
