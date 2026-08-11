import {
  PLACEHOLDER_LABEL_PREFIX,
  type DerivedBox,
} from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * What the fill surface needs to draw somebody's sheet: the boxes, where they sit, and what each
 * one is called.
 *
 * Pure, and built from a SAVED chassis rather than from the PDF. That is the whole point of the
 * module. The debug page worked this out per request by opening the file again, which is fine for
 * three fixtures and wrong for a driver: the uploader's PDF goes with them if they delete their
 * account, and the chassis is shared, so the sheet has to keep drawing for everyone else. The
 * geometry is stored once at upload and read from there forever after.
 *
 * Deliberately a plain data shape, not a component prop type: a 289-box sheet is a large value, and
 * it travels to the browser as its own JSON response rather than through the page format. See the
 * note in `api/debug/sheet-plan` — a single large value spanning chunk boundaries broke roughly one
 * page load in three at 289 boxes, and never at 15.
 */

export type SheetPlanField = {
  key: string;
  label: string;
  /** Nobody has said what this box is yet, so the label is only its position on the paper. */
  unnamed: boolean;
  uiType: "text" | "checkbox";
  sectionTitle?: string;
  options?: string[];
  /**
   * Stored value for each entry of `options`, index-aligned. Present only on a calibrated chassis
   * whose schema declares them; a derived sheet's options are their own stored values.
   */
  optionValues?: string[];
  /** Many-of-many: the value is a set of options, not one. */
  multi?: boolean;
};

export type SheetPlan = {
  fields: SheetPlanField[];
  boxes: DerivedBox[];
  pageCount: number;
  /** Boxes a human has named. What is left is what the founder still faces. */
  namedCount: number;
};

/** A label the app generated because the PDF gave it nothing to go on. */
export function isPlaceholderLabel(label: string): boolean {
  return label.startsWith(PLACEHOLDER_LABEL_PREFIX);
}

/**
 * Build the plan from a chassis's schema plus the box geometry stored with its blank.
 *
 * A field with no box is dropped rather than shown. That happens when the founder adds a parameter
 * by hand to a derived sheet: it is a real parameter and belongs in the ordinary form, but it has
 * nowhere to sit on the paper, and drawing it at a made-up position would be worse than the driver
 * not seeing it here.
 */
export function buildSheetPlan(input: {
  schema: Pick<SetupSheetModelSchema, "fields">;
  boxes: DerivedBox[];
}): SheetPlan {
  // A grouped parameter's printed tick boxes all share its key — see `DerivedBox.optionValue` —
  // so a key maps to a LIST of boxes. Derived sheets only ever have lists of one.
  const boxesByKey = new Map<string, DerivedBox[]>();
  for (const b of input.boxes) {
    const list = boxesByKey.get(b.key);
    if (list) list.push(b);
    else boxesByKey.set(b.key, [b]);
  }

  const fields: SheetPlanField[] = [];
  const boxes: DerivedBox[] = [];
  for (const f of input.schema.fields) {
    const fieldBoxes = boxesByKey.get(f.key);
    if (!fieldBoxes?.length) continue;
    fields.push({
      key: f.key,
      label: f.displayLabel,
      unnamed: isPlaceholderLabel(f.displayLabel),
      uiType: f.uiType === "checkbox" ? "checkbox" : "text",
      ...(f.sectionTitle ? { sectionTitle: f.sectionTitle } : {}),
      ...(f.groupedOptionLabels?.length ? { options: f.groupedOptionLabels } : {}),
      ...(f.groupedOptionLabels?.length && f.groupedOptionValues?.length
        ? { optionValues: f.groupedOptionValues }
        : {}),
      ...(f.uiType === "multiSelect" ? { multi: true } : {}),
    });
    boxes.push(...fieldBoxes);
  }

  return {
    fields,
    boxes,
    pageCount: boxes.length ? Math.max(...boxes.map((b) => b.pageNumber), 1) : 1,
    namedCount: fields.filter((f) => !f.unnamed).length,
  };
}

/**
 * Does this chassis fill as a sheet, or as the ordinary form?
 *
 * Turns on geometry, NOT on how many boxes are still unnamed. Counting unnamed boxes looks like the
 * obvious test and is the dangerous one: a half-named sheet would fall back to the form, and the
 * form only shows fields flagged `showInLogRun` — which every unnamed box has set to false. The
 * driver would be handed a shorter form that silently drops the rest of their sheet.
 *
 * So the question is only ever "can we draw this sheet". `fillSurface` is the admin's override, set
 * deliberately once the founder has named a chassis, so nobody's surface changes under them
 * mid-season.
 */
export function chassisFillsAsSheet(
  blank: { boxesJson?: unknown; fillSurface?: string | null } | null | undefined
): boolean {
  if (!blank) return false;
  if (blank.fillSurface === "form") return false;
  return Array.isArray(blank.boxesJson) && blank.boxesJson.length > 0;
}

/** `SetupSheetBlank.boxesJson` back as boxes, tolerating a row written by an older shape. */
export function parseStoredBoxes(boxesJson: unknown): DerivedBox[] {
  if (!Array.isArray(boxesJson)) return [];
  const out: DerivedBox[] = [];
  for (const raw of boxesJson) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    if (typeof b.key !== "string" || !b.key) continue;
    if (typeof b.pageNumber !== "number") continue;
    if (
      typeof b.x !== "number" ||
      typeof b.y !== "number" ||
      typeof b.width !== "number" ||
      typeof b.height !== "number"
    ) {
      continue;
    }
    out.push(raw as unknown as DerivedBox);
  }
  return out;
}
