import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { A800RR_STRUCTURED_SECTIONS } from "@/lib/a800rrSetupDisplayConfig";

/**
 * Awesomatix A800RR setup template (structured sheet + comparison-ready keys).
 * `structuredSections` drives SetupSheetView; `groups` is empty — catalog comes from structured layout.
 */
export const A800RR_SETUP_SHEET_V1: SetupSheetTemplate = {
  id: "awesomatix_a800rr_v1",
  label: "Awesomatix A800RR",
  groups: [],
  structuredSections: A800RR_STRUCTURED_SECTIONS,
};
