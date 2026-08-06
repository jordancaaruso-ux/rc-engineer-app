import {
  buildSetupSheetTemplateFromParsedSchema,
  type SetupSheetTemplateView,
} from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import { buildGenericPresetSchema } from "@/lib/setupSheetModels/genericPresetSchema";
import { GENERIC_SETUP_SHEET_V1, type SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/**
 * The generic touring sheet, built the same way a real chassis model's sheet is built.
 *
 * A car whose chassis has no curated model falls back to `GENERIC_SETUP_SHEET_V1`. That raw
 * constant describes only labels, units and layout — its fields carry no `valueType`, no `input`,
 * and it has no chip options. `buildSetupFillSteps` reads exactly those to pick a control, so every
 * one of the 43 steps came out as free text: no numeric keypad on camber, no Surface or Traction
 * chips, on the one sheet filled by drivers the app knows least about.
 *
 * `buildGenericPresetSchema` already derives all of it — `valueType`, `uiType`, units, the option
 * sets, the droop/downstop notes and each field's `universalParameterId` — for exactly these 43
 * keys, because it is what seeds every generic-preset catalog model. Routing the fallback through
 * it means a model-less car and a generic-seeded-model car behave identically **by construction**
 * rather than by two hand-maintained copies that drift the first time a field is added. Running the
 * result through `buildSetupSheetTemplateFromParsedSchema` also puts the sheet into the same seven
 * `SETUP_SHEET_GROUPS` every model-backed sheet uses, so it stops reading in its own vocabulary.
 *
 * Display order changes as a result: Session fields (`driver`, `setup_date`, `track_surface`,
 * `track_layout`, `traction`) group into "Other", which sorts last — exactly as they already do on
 * a model-backed sheet. **Guided fill order is untouched**; `groupFieldsBySection` buckets by the
 * sheet's own `sectionId`, so filling still walks Session → Suspension → Geometry → Drivetrain →
 * Tyres. That split is deliberate: display is uniform across chassis, fill follows the paper.
 *
 * Lives in its own module rather than inside `setupSheetTemplate.ts` because `genericPresetSchema`
 * imports `GENERIC_SETUP_SHEET_V1` as a value — calling it from there is a real import cycle.
 */

const LABEL = "Generic touring";

/**
 * Kept as the template id so the `data-setup-sheet-template` contract that `SetupSheetView` and its
 * tests read is unchanged; the builder would otherwise emit `model-generic-v1`.
 */
const GENERIC_TEMPLATE_ID = GENERIC_SETUP_SHEET_V1.id;

/** Pure and deterministic, so the build is done once per view and reused. Three entries at most. */
const cache = new Map<SetupSheetTemplateView, SetupSheetTemplate>();

export function getGenericSetupSheetTemplate(
  view: SetupSheetTemplateView = "setup"
): SetupSheetTemplate {
  const cached = cache.get(view);
  if (cached) return cached;

  const built = buildSetupSheetTemplateFromParsedSchema(
    GENERIC_TEMPLATE_ID,
    LABEL,
    buildGenericPresetSchema(LABEL),
    view,
    // No chassis-type key: a model-less car must not borrow another chassis' community data.
    null
  );
  const template: SetupSheetTemplate = { ...built, id: GENERIC_TEMPLATE_ID, label: LABEL };
  cache.set(view, template);
  return template;
}
