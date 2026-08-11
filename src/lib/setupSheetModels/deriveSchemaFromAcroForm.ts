import type { PdfFormFieldEntry, PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import { DEFAULT_PDF_FIELD_APPEARANCE } from "@/lib/setupDocuments/pdfFieldAppearance";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { inferUiTypeFromAcroType, suggestKeyFromPdfFieldName } from "@/lib/setupCalibrations/customFieldCatalog";
import { reservedSafeDerivedKey } from "@/lib/setupSheetModels/reservedSetupKeys";

/**
 * Turn a manufacturer's blank setup sheet into a parameter list, using only the PDF's form layer.
 *
 * ============================ WHAT THIS DELIBERATELY DOES NOT DO ============================
 *
 * It never looks at printed text, and it never reasons about what is drawn *near* a box. An
 * earlier pipeline did exactly that and was deleted on 2026-08-06: the nearest printed phrase to a
 * box is very often a part number rather than a caption, so on the A800RR it proposed 122 names
 * for 232 boxes and flagged 154 clashes, nineteen of them all claiming "TW5" — and two of the four
 * sheets examined had no usable text layer at all. Everything here comes from the form layer,
 * which is structured data the file states outright: field names, rectangles, types, option lists.
 *
 * So this pass is deterministic and total. Every widget becomes exactly one fillable box, always.
 * What varies is only how much MEANING comes with it, and that varies by manufacturer:
 *
 *   Xray X4 2026   201 fields, 0% generic names   → `fr-shock-oil`, `pinion`, `fdr`, `traction`
 *   Xray X4 2022   178 fields, 3% generic names
 *   Mugen MTC3     142 fields, 100% generic names → `Text2` … `Text142`, nothing else
 *
 * A sheet in the second class still works: the driver can fill every box, because the printed
 * caption is right there on their own sheet. It just needs a human to name the boxes once before
 * the Engineer can read it. That is the Tier 1 → Tier 2 step, and it is a rename, never a rebuild.
 *
 * ================================ THE KEY IS PERMANENT ================================
 *
 * The `key` minted here is the single most consequential output. The moment one driver saves one
 * sheet it is frozen into run history (immutable), fill drafts, baselines, setup deltas, the
 * calibration's field mappings, and every aggregation row. Naming a box later changes its
 * `displayLabel` and `universalParameterId` — NEVER its key. Renaming a key does not error; it
 * silently empties every saved sheet that used it.
 */

/** Marks a label the app generated because the PDF gave it nothing to go on. */
export const PLACEHOLDER_LABEL_PREFIX = "Box ";

export type DerivedSheet = {
  schema: SetupSheetModelSchema;
  /** Schema key -> where that parameter lives on this specific blank. */
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  /** Where each parameter sits on the page, for drawing it. */
  boxes: DerivedBox[];
  stats: DerivedSheetStats;
};

/**
 * One box as the fill surface needs it: which page, and where on that page as a fraction of the
 * page's own size.
 *
 * Fractions rather than points so the client never has to know the paper size or the scale it
 * happens to be rendering at — the same numbers place the box in a thumbnail, at full width, and
 * zoomed in on a phone.
 */
export type DerivedBox = {
  key: string;
  pageNumber: number;
  /** All four are 0–1, measured from the top-left of the page. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** How this sheet draws a value in this box. See `DerivedBoxStyle`. */
  style: DerivedBoxStyle;
  /**
   * Set when this box is ONE OPTION of a grouped parameter rather than the parameter itself — the
   * printed tick boxes of a one-of-many row. Several boxes then share one `key`, and a box shows
   * its mark when the parameter's value matches (case-insensitively) its `optionValue`.
   *
   * A derivation never writes this: it exists for a calibrated chassis, where the calibration
   * already says which printed box is which choice. Absent everywhere else, so every existing
   * sheet keeps its one-box-per-key shape untouched.
   */
  optionValue?: string;
};

/**
 * The look of a filled-in value, taken from the PDF rather than chosen by the app.
 *
 * Every one of these comes out of the file: the font, size and colour from the field's default
 * appearance string, the alignment from its quadding, the mark from the tick box's own caption.
 * Drawing values any other way makes the sheet stop looking like the sheet the driver fills in
 * Acrobat, which is the whole reason they wanted their own sheet in the app.
 */
export type DerivedBoxStyle = {
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  color: string;
  alignment: "left" | "center" | "right";
  /**
   * Font size as a fraction of the page height, so it survives being drawn at any scale.
   * **0 means auto** — size it to the box, which is what a viewer does with `0 Tf`.
   */
  fontSizeFrac: number;
  /** Tick boxes only: the mark this box makes when it is ticked. */
  checkMark?: string;
};

export type DerivedSheetStats = {
  /** AcroForm fields read off the blank. */
  fieldCount: number;
  /** Parameters minted. Exceeds `fieldCount` when a field's widgets are split per box. */
  parameterCount: number;
  /** Parameters whose label had to be generated because the field name said nothing. */
  placeholderLabelCount: number;
  /** Parameters that carry real choices lifted from the PDF's own option list. */
  withOptionsCount: number;
  /** Keys that collided and were given a numeric suffix — permanent, so worth watching. */
  collisionCount: number;
  /** Which ones, so a collision can be looked at rather than merely counted. */
  collidedKeys: string[];
  /** Field names long enough to be cut by the 48-char key limit — also permanent. */
  truncatedKeyCount: number;
  /**
   * Boxes whose name matched one the app rewrites on save, and so was given a suffix. See
   * `reservedSetupKeys.ts` — a box called "Camber front" would otherwise have its sign flipped.
   */
  reservedKeyCount: number;
  /** Which ones, since the suffix is permanent and worth being able to look at. */
  reservedKeys: string[];
  /** Fields with several boxes sharing one name, split into one parameter per box. */
  splitFieldCount: number;
};

/**
 * Acrobat's defaults, plus the shapes other editors emit. A name matching one of these carries no
 * information, so the parameter gets a positional placeholder label instead and is held back from
 * analysis until a human names it.
 */
const GENERIC_NAME_PATTERNS = [
  /^text\d*$/i,
  /^field\d*$/i,
  /^untitled\d*$/i,
  /^check\s?box\d*$/i,
  /^checkbox\d*$/i,
  /^radio\s?button\d*$/i,
  /^button\d*$/i,
  /^dropdown\d*$/i,
  /^combo\s?box\d*$/i,
  /^list\s?box\d*$/i,
  /^form\d*$/i,
  /^[a-z]?\d+$/i,
];

export function isGenericAcroFieldName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  return GENERIC_NAME_PATTERNS.some((re) => re.test(n));
}

/**
 * A field name turned into something a person can read: `fr-shock-oil` → "Fr shock oil".
 *
 * Intentionally light. Expanding abbreviations ("fr" → "front") is guesswork that reads as
 * confident, and a wrong expansion is worse than an honest raw name — the driver is looking at the
 * printed sheet and can tell instantly that "Fr shock oil" is their front shock oil box.
 */
export function labelFromAcroFieldName(name: string): string {
  const words = name
    .trim()
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Where on the paper, in words — the only thing that can be said about an unnamed box. */
function positionalLabel(
  ordinal: number,
  widget: { pageNumber: number; x: number; y: number; pageWidth: number; pageHeight: number } | undefined
): string {
  if (!widget) return `${PLACEHOLDER_LABEL_PREFIX}${ordinal}`;
  const vertical = widget.y / widget.pageHeight < 0.33 ? "upper" : widget.y / widget.pageHeight > 0.66 ? "lower" : "middle";
  const horizontal = widget.x / widget.pageWidth < 0.33 ? "left" : widget.x / widget.pageWidth > 0.66 ? "right" : "centre";
  return `${PLACEHOLDER_LABEL_PREFIX}${ordinal} · page ${widget.pageNumber}, ${vertical} ${horizontal}`;
}

type Placed = {
  entry: PdfFormFieldEntry;
  /** The widget this parameter owns, or undefined for a whole-field parameter. */
  widgetIndex?: number;
  pageNumber: number;
  y: number;
  x: number;
};

/**
 * Reader order across the WHOLE document — page, then down, then across.
 *
 * `collectWidgetLayouts` already sorts within one field; this is the same rule applied across
 * fields, which is what makes the fill flow sweep the sheet the way a person reads it instead of
 * hopping about in whatever order the PDF happens to store its fields.
 */
function readerOrder(a: Placed, b: Placed): number {
  if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
  // Rows first: boxes within ~4pt of each other are the same line, so order them left to right.
  if (Math.abs(a.y - b.y) > 4) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return 0;
}

/**
 * Group boxes into sections without reading the page.
 *
 * Two strategies, in order of how much they actually know:
 *
 *  1. **Name prefix** — `fr-camber`, `fr-toe`, `re-camber` split on their leading token. Free and
 *     genuinely meaningful, but only where the manufacturer named its fields (Xray). Used when it
 *     explains most of the sheet; otherwise a handful of prefixes would produce mostly-empty
 *     sections plus a huge "everything else".
 *  2. **Geometry** — a new block wherever the vertical gap between consecutive rows jumps well
 *     above the typical gap. Says nothing about meaning, but it does reliably follow the printed
 *     blocks, because sheets put whitespace between their sections. Titles are honest about this:
 *     "Page 2 · block C", not an invented subject.
 */
const NAME_PREFIX_COVERAGE_THRESHOLD = 0.6;

function prefixOf(name: string): string | null {
  const m = name.trim().match(/^([A-Za-z]{1,6})[-_.]/);
  return m ? m[1]!.toLowerCase() : null;
}

function sectionsByNamePrefix(placed: Placed[]): Map<Placed, { id: string; title: string }> | null {
  const counts = new Map<string, number>();
  for (const p of placed) {
    const pre = prefixOf(p.entry.name);
    if (!pre) continue;
    counts.set(pre, (counts.get(pre) ?? 0) + 1);
  }
  // A prefix seen once is a coincidence, not a section.
  let covered = 0;
  for (const [, n] of counts) if (n >= 2) covered += n;
  if (placed.length === 0 || covered / placed.length < NAME_PREFIX_COVERAGE_THRESHOLD) return null;

  const out = new Map<Placed, { id: string; title: string }>();
  for (const p of placed) {
    const pre = prefixOf(p.entry.name);
    const useable = pre && (counts.get(pre) ?? 0) >= 2 ? pre : null;
    out.set(
      p,
      useable
        ? { id: `grp_${useable}`, title: labelFromAcroFieldName(useable) }
        : { id: "grp_other", title: "Other" }
    );
  }
  return out;
}

function sectionsByGeometry(placed: Placed[]): Map<Placed, { id: string; title: string }> {
  const out = new Map<Placed, { id: string; title: string }>();
  const byPage = new Map<number, Placed[]>();
  for (const p of placed) {
    const list = byPage.get(p.pageNumber) ?? [];
    list.push(p);
    byPage.set(p.pageNumber, list);
  }

  for (const [pageNumber, items] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    // Distinct row positions, so a wide row of ten boxes counts once rather than swamping the median.
    const rows: number[] = [];
    for (const it of items) {
      if (rows.length === 0 || Math.abs(it.y - rows[rows.length - 1]!) > 4) rows.push(it.y);
    }
    const gaps: number[] = [];
    for (let i = 1; i < rows.length; i++) gaps.push(rows[i]! - rows[i - 1]!);
    const sorted = [...gaps].sort((a, b) => a - b);
    const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
    // 2.2x the typical row gap: comfortably past ordinary line spacing, short of a page break.
    const breakAt = medianGap > 0 ? medianGap * 2.2 : Number.POSITIVE_INFINITY;

    let blockIndex = 0;
    let previousY: number | null = null;
    for (const it of items) {
      if (previousY !== null && it.y - previousY > breakAt) blockIndex += 1;
      previousY = it.y;
      const letter = String.fromCharCode(65 + (blockIndex % 26));
      out.set(it, {
        id: `p${pageNumber}_block_${blockIndex}`,
        title: `Page ${pageNumber} · block ${letter}`,
      });
    }
  }
  return out;
}

/**
 * A field whose several boxes are one choice — a row of tick boxes sharing a name — versus one
 * whose boxes are separate values.
 *
 * Only checkbox/radio fields can be a choice group; a text field with two widgets is two places to
 * write, not two options. Even then this is the one guess in the whole pass that can be
 * structurally wrong rather than merely unnamed, so a group only forms when the PDF supplies real
 * option labels for it. Without labels the boxes are split into separate parameters, which is the
 * recoverable mistake: merging two boxes later is a supported edit, whereas a wrongly-merged group
 * has already thrown away which box the driver actually ticked.
 */
function isChoiceGroup(entry: PdfFormFieldEntry): boolean {
  const toggle = entry.type === "CheckBox" || entry.type === "RadioGroup";
  return toggle && entry.widgets.length > 1 && (entry.options?.length ?? 0) >= entry.widgets.length;
}

export function deriveSchemaFromAcroForm(
  extraction: PdfFormFieldsExtraction,
  label: string
): DerivedSheet {
  const usable = extraction.fields.filter((f) => f.widgets.length > 0);

  // One `Placed` per parameter-to-be, so ordering and sectioning work on the same units the schema
  // will have.
  const placed: Placed[] = [];
  let splitFieldCount = 0;
  for (const entry of usable) {
    if (entry.widgets.length === 1 || isChoiceGroup(entry)) {
      const w = entry.widgets[0]!;
      placed.push({ entry, pageNumber: w.pageNumber, y: w.y, x: w.x });
      continue;
    }
    splitFieldCount += 1;
    for (const w of entry.widgets) {
      placed.push({ entry, widgetIndex: w.instanceIndex, pageNumber: w.pageNumber, y: w.y, x: w.x });
    }
  }

  placed.sort(readerOrder);

  const sections = sectionsByNamePrefix(placed) ?? sectionsByGeometry(placed);

  const fields: SetupSheetModelFieldDef[] = [];
  const boxes: DerivedBox[] = [];
  const formFieldMappings: Record<string, PdfFormFieldMappingRule> = {};
  const takenKeys = new Set<string>();
  const stats: DerivedSheetStats = {
    fieldCount: extraction.fields.length,
    parameterCount: 0,
    placeholderLabelCount: 0,
    withOptionsCount: 0,
    collisionCount: 0,
    collidedKeys: [],
    truncatedKeyCount: 0,
    reservedKeyCount: 0,
    reservedKeys: [],
    splitFieldCount,
  };

  placed.forEach((p, index) => {
    const { entry, widgetIndex } = p;
    const generic = isGenericAcroFieldName(entry.name);

    /*
     * The split suffix is appended AFTER normalising the field name, and uses a double underscore.
     *
     * Measured on the real Xray blanks: naming the split boxes `${name}_${index}` collides with the
     * manufacturer's own naming. `fr-offset` has three boxes, so its second becomes `fr_offset_1`
     * — and the sheet separately contains a field actually called `fr-offset-1`, a different box in
     * a different place. One of the two then carries a `_2` disambiguator forever, attached to
     * whichever happened to be read second.
     *
     * `suggestKeyFromPdfFieldName` collapses every run of non-alphanumerics to a single underscore,
     * so a doubled underscore cannot come out of any field name — which makes `__b1` a suffix that
     * is structurally incapable of colliding with one.
     */
    const nameKey = suggestKeyFromPdfFieldName(entry.name);
    const rawKeyBase = widgetIndex === undefined ? nameKey : `${nameKey}__b${widgetIndex + 1}`;
    if (nameKey.length >= 48) stats.truncatedKeyCount += 1;

    /*
     * A handful of names are not free for the taking: the app rewrites the value stored under them.
     * A box called "Camber front" would come back with its sign flipped, and one called "Chassis"
     * would be parsed against the A800RR's part-number list. Suffix them so a derived box always
     * stores exactly what the driver typed. Full reasoning in `reservedSetupKeys.ts`.
     */
    const keyBase = reservedSafeDerivedKey(rawKeyBase);
    if (keyBase !== rawKeyBase) {
      stats.reservedKeyCount += 1;
      stats.reservedKeys.push(`${rawKeyBase} → ${keyBase} (PDF field "${entry.name}")`);
    }

    let key = keyBase;
    if (takenKeys.has(key)) {
      stats.collisionCount += 1;
      stats.collidedKeys.push(`${keyBase} (PDF field "${entry.name}")`);
      let n = 2;
      while (takenKeys.has(`${key}_${n}`)) n += 1;
      key = `${key}_${n}`;
    }
    takenKeys.add(key);

    const ordinal = index + 1;
    const widget = widgetIndex === undefined ? entry.widgets[0] : entry.widgets[widgetIndex];
    const derivedLabel = generic ? "" : labelFromAcroFieldName(entry.name);
    // A split box is one tick box out of a row that shares a name — "Surface, box 1 of 2" rather
    // than "Surface (1)", because on the paper it literally is the first of two boxes beside the
    // word SURFACE and the driver is matching what they see.
    const displayLabel = derivedLabel
      ? widgetIndex === undefined
        ? derivedLabel
        : `${derivedLabel} · box ${widgetIndex + 1} of ${entry.widgets.length}`
      : positionalLabel(ordinal, widget);
    if (!derivedLabel) stats.placeholderLabelCount += 1;

    const section = sections.get(p) ?? { id: "grp_other", title: "Other" };
    const options = isChoiceGroup(entry) ? entry.options ?? [] : [];
    if (options.length > 0) stats.withOptionsCount += 1;

    const field: SetupSheetModelFieldDef = {
      key,
      displayLabel,
      sectionId: section.id,
      sectionTitle: section.title,
      valueType: "string",
      uiType: options.length > 0 ? "text" : inferUiTypeFromAcroType(entry.type),
      showInSetupSheet: true,
      // A two-hundred-question log-run flow is unusable, and an unnamed box means nothing to the
      // Engineer or to a comparison — so an underived sheet stays out of both until it is named.
      showInLogRun: false,
      // A split box is a bare yes/no out of a row of ticks: on its own "Surface, box 1 of 2 = on"
      // tells a comparison nothing, and the row only becomes a real answer once someone merges it
      // into one choice with labels. Named single boxes are analysable straight away.
      showInAnalysis: !generic && widgetIndex === undefined,
      sortOrder: ordinal,
      ...(options.length > 0
        ? {
            // Mutually exclusive: the PDF gave one option per box, so exactly one can be on.
            groupBehaviorType: "singleChoiceGroup" as const,
            groupedOptionLabels: options,
            groupedOptionValues: options,
          }
        : {}),
    };
    fields.push(field);

    formFieldMappings[key] = {
      pdfFieldName: entry.name,
      ...(widgetIndex === undefined ? {} : { widgetInstanceIndex: widgetIndex }),
    } as PdfFormFieldMappingRule;

    if (widget) {
      const a = entry.appearance ?? DEFAULT_PDF_FIELD_APPEARANCE;
      boxes.push({
        key,
        pageNumber: widget.pageNumber,
        x: widget.x / widget.pageWidth,
        y: widget.y / widget.pageHeight,
        width: widget.width / widget.pageWidth,
        height: widget.height / widget.pageHeight,
        style: {
          fontFamily: a.fontFamily,
          bold: a.bold,
          italic: a.italic,
          color: a.color,
          alignment: a.alignment,
          fontSizeFrac: a.fontSize > 0 ? a.fontSize / widget.pageHeight : 0,
          ...(widget.checkMark ? { checkMark: widget.checkMark } : {}),
        },
      });
    }
  });

  stats.parameterCount = fields.length;

  return {
    schema: {
      version: 1,
      label,
      // Left empty on purpose: `buildSetupSheetTemplate` infers a layout from the fields when a
      // sheet has none, and an inferred layout that follows the paper's own reader order beats one
      // this pass would have to invent.
      structuredSections: [],
      fields,
    },
    formFieldMappings,
    boxes,
    stats,
  };
}
