import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  type PDFField,
} from "pdf-lib";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

/**
 * Deterministic structure read of a manufacturer's *blank* AcroForm setup sheet: every input box,
 * its exact rectangle, its type, and the reader-order widget indices the import pipeline uses.
 *
 * This is the whole foundation of fast chassis onboarding. Structure comes from the PDF and is
 * exact; only *semantics* (what a box means) need a human, which is what `matchFields` and the
 * onboarding wizard handle. Nothing here calls a model.
 *
 * Supersedes `parseBlankAcroFormGeometry` (setupExtractAi/draftCalibrationFromBlankSheet.ts), whose
 * three documented defects are fixed here: page-1-only normalization, push-buttons drafted as
 * schema fields, and dropdown option lists never being read.
 */

export type OnboardingWidget = {
  /** Raw pdf-lib `getWidgets()` position — the index geometry callers address boxes by. */
  widgetIndex: number;
  /**
   * The index the PDF *reader* uses for this box. `collectWidgetLayouts`
   * (setupDocuments/pdfFormFields.ts) re-sorts a field's widgets by (page, y, x) and renumbers
   * them 0..n-1; import rules address widgets by that number, so emitting raw order would map
   * every checkbox option to the wrong box.
   */
  instanceIndex: number;
  /** 1-based, matching `PdfFormFieldWidgetRect.pageNumber`. */
  pageNumber: number;
  /** Normalized against ITS OWN page, top-left origin. */
  region: ImageRegion;
};

export type OnboardingFieldKind = "text" | "checkbox" | "dropdown";

export type OnboardingGeometryField = {
  /** AcroForm field name, verbatim (e.g. "fr-shock-oil"). */
  acroName: string;
  /** Slug derived from `acroName`; unique within the sheet. Becomes the schema field key. */
  key: string;
  kind: OnboardingFieldKind;
  /** Dropdown/option-list choices carried by the PDF itself — real option labels, for free. */
  pdfOptions?: string[];
  widgets: OnboardingWidget[];
};

export type OnboardingGeometry = {
  pageCount: number;
  /** Size of each page in points, index 0 = page 1. */
  pageSizes: Array<{ widthPt: number; heightPt: number }>;
  fields: OnboardingGeometryField[];
  warnings: string[];
};

type AcroWidgetLike = {
  getRectangle(): { x: number; y: number; width: number; height: number };
  P(): { toString(): string } | undefined;
};

function fieldKind(field: PDFField): OnboardingFieldKind | null {
  // Push-buttons ("reset all" on the X4 sheet) are controls, not data. The legacy drafter had no
  // such test, so they became schema fields a human then had to delete.
  if (field instanceof PDFButton) return null;
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) return "checkbox";
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return "dropdown";
  return "text";
}

function readPdfOptions(field: PDFField): string[] | undefined {
  if (!(field instanceof PDFDropdown) && !(field instanceof PDFOptionList)) return undefined;
  try {
    const options = field.getOptions().map((o) => o.trim()).filter(Boolean);
    return options.length > 0 ? options : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Slug an AcroForm field name into a schema key. The key is permanent once minted — a driver's
 * saved values are stored under it, so renaming the *label* later must never touch it.
 */
export function keyFromAcroName(name: string, seen: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
  let key = base;
  let n = 1;
  while (seen.has(key)) {
    n += 1;
    key = `${base}_${n}`;
  }
  seen.add(key);
  return key;
}

export async function parseOnboardingGeometry(pdfBytes: Buffer): Promise<OnboardingGeometry> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const pageSizes = pages.map((p) => ({ widthPt: p.getWidth(), heightPt: p.getHeight() }));
  const refToIndex = new Map<string, number>();
  pages.forEach((p, i) => refToIndex.set(p.ref.toString(), i));

  const warnings: string[] = [];
  const fields: OnboardingGeometryField[] = [];
  const seenKeys = new Set<string>();
  let orphanWidgets = 0;

  for (const field of doc.getForm().getFields()) {
    const kind = fieldKind(field);
    if (!kind) continue;

    const acroName = field.getName();
    // Collect in raw order first so `widgetIndex` stays addressable, then sort a copy to assign
    // reader-order `instanceIndex` — the same two-step `collectWidgetLayouts` performs.
    const raw: Array<{ widgetIndex: number; pageIdx: number; xPt: number; yTopPt: number; region: ImageRegion }> = [];
    const widgets = field.acroField.getWidgets() as AcroWidgetLike[];

    widgets.forEach((w, widgetIndex) => {
      const pageRef = w.P();
      const pageIdx = pageRef ? refToIndex.get(pageRef.toString()) : undefined;
      if (pageIdx === undefined) {
        orphanWidgets += 1;
        return;
      }
      const size = pageSizes[pageIdx]!;
      const r = w.getRectangle();
      // PDF y-origin is bottom-left; regions are top-left. Normalize against THIS page, not page 1.
      const yTopPt = size.heightPt - r.y - r.height;
      raw.push({
        widgetIndex,
        pageIdx,
        xPt: r.x,
        yTopPt,
        region: {
          xPct: r.x / size.widthPt,
          yPct: yTopPt / size.heightPt,
          wPct: r.width / size.widthPt,
          hPct: r.height / size.heightPt,
        },
      });
    });

    if (raw.length === 0) continue;

    // Sort in POINTS, not percentages: on a mixed-page-size PDF the two orders differ, and the
    // reader sorts in points.
    const readerOrder = [...raw].sort((a, b) => {
      if (a.pageIdx !== b.pageIdx) return a.pageIdx - b.pageIdx;
      if (a.yTopPt !== b.yTopPt) return a.yTopPt - b.yTopPt;
      if (a.xPt !== b.xPt) return a.xPt - b.xPt;
      return a.widgetIndex - b.widgetIndex;
    });
    const instanceByWidgetIndex = new Map<number, number>();
    readerOrder.forEach((w, i) => instanceByWidgetIndex.set(w.widgetIndex, i));

    fields.push({
      acroName,
      key: keyFromAcroName(acroName, seenKeys),
      kind,
      pdfOptions: readPdfOptions(field),
      widgets: raw.map((w) => ({
        widgetIndex: w.widgetIndex,
        instanceIndex: instanceByWidgetIndex.get(w.widgetIndex)!,
        pageNumber: w.pageIdx + 1,
        region: w.region,
      })),
    });
  }

  if (orphanWidgets > 0) {
    warnings.push(`${orphanWidgets} widget(s) had no resolvable page and were dropped`);
  }

  return { pageCount: pages.length, pageSizes, fields, warnings };
}

/** True when the PDF carries usable form fields — the gate for the whole onboarding path. */
export function hasUsableFormFields(geometry: OnboardingGeometry): boolean {
  return geometry.fields.length > 0;
}
