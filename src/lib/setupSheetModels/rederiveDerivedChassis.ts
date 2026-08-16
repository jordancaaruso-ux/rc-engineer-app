import "server-only";

import { prisma } from "@/lib/prisma";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import {
  derivedSheetFingerprint,
  derivedSheetSlug,
  isDerivedSheetSlug,
} from "@/lib/setupSheetModels/derivedSheetFingerprint";
import { prerenderSheetPages } from "@/lib/setupSheetModels/sheetPageImages";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * Read a driver-derived chassis off its own PDF again, and keep the answer.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * Every chassis a driver created from their own sheet between 2026-08-11 and 2026-08-14 was derived
 * by a production build in which `pdf-lib`'s classes had been minified, so `field.constructor.name`
 * answered `"e"` for all of them (see `acroFieldTypeName`). Two consequences, both stored:
 *
 *   1. Every box became a free-text box. A tick box on the paper drew as a line to type on.
 *   2. `isChoiceGroup` never fired, so a row of ticks sharing one field name was split into one
 *      parameter per box (`surface__b1`, `surface__b2`, …) instead of becoming one "pick one of
 *      these" with the PDF's own option labels.
 *
 * The second is why this cannot be a `uiType` patch. The KEYS are wrong, and a key is what a saved
 * setup is stored under, so putting the sheet right means re-deriving and accepting that values a
 * driver typed into a split tick box no longer have a parameter to hang on. `keysLosingValues`
 * counts exactly that before anything is written, so the cost is seen rather than discovered.
 *
 * =========================== ONLY DERIVED CHASSIS ===========================
 *
 * `isDerivedSheetSlug` is the gate. A CURATED chassis (the A800RR) carries a hand-authored
 * calibration whose keys have two seasons of runs behind them; re-deriving one would replace those
 * keys with `text91`-style derivations of the same boxes. Those chassis were never affected anyway —
 * they are built by CLI scripts on a laptop, where class names survive.
 *
 * ========================= THE SLUG MOVES WITH THE SHEET =========================
 *
 * A derived chassis's slug IS its fingerprint, which is how two drivers holding one manufacturer's
 * sheet land on one row. A corrected derivation fingerprints differently, so the slug has to follow
 * or the next driver to upload that same PDF mints a second row beside this one. If the corrected
 * slug is already taken — someone uploaded that sheet after the fix shipped — the row keeps its old
 * slug and says so: two rows for one sheet is an admin merge, whereas moving a slug onto another
 * row's identity is not recoverable.
 */

export type RederiveResult = {
  modelId: string;
  name: string;
  slug: string;
  /** The slug the corrected derivation asks for. Equal to `slug` when nothing moved. */
  nextSlug: string;
  slugTakenByOtherModel: boolean;
  boxCountBefore: number;
  boxCountAfter: number;
  /** Boxes that were text and are now ticks — the visible half of the bug. */
  becameCheckbox: number;
  /** Parameters that now carry the PDF's own option labels instead of being one box each. */
  choiceGroupsFormed: number;
  keysAdded: string[];
  keysRemoved: string[];
  /** Removed keys that a saved setup has a value under, with how many snapshots hold one. */
  keysLosingValues: Array<{ key: string; snapshotCount: number }>;
  applied: boolean;
};

export async function rederiveDerivedChassis(input: {
  setupSheetModelId: string;
  /** False previews every count without writing a byte. */
  apply: boolean;
}): Promise<RederiveResult> {
  const model = await prisma.setupSheetModel.findUnique({
    where: { id: input.setupSheetModelId },
    select: {
      id: true,
      name: true,
      slug: true,
      schemaJson: true,
      defaultCalibrationId: true,
      defaultCalibration: { select: { id: true, calibrationDataJson: true } },
      // Re-derivation replaces the PRIMARY blank's boxes; editions have their own derivations.
      sheetBlanks: {
        where: { isEdition: false },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          id: true,
          boxesJson: true,
          setupDocument: { select: { storagePath: true } },
        },
      },
    },
  });
  if (!model) throw new Error(`unknown chassis ${input.setupSheetModelId}`);
  if (!isDerivedSheetSlug(model.slug)) {
    throw new Error(
      `${model.name} (${model.slug}) is a curated chassis — re-deriving would replace hand-authored keys`
    );
  }

  const blank = model.sheetBlanks[0] ?? null;
  if (!blank?.setupDocument?.storagePath) {
    throw new Error(`chassis ${model.name} has no stored blank PDF to read again`);
  }

  const oldSchema = parseSetupSheetModelSchema(model.schemaJson);
  const oldFields = oldSchema?.fields ?? [];
  const oldByKey = new Map(oldFields.map((f) => [f.key, f] as const));

  const { readBytesFromStorageRef } = await import("@/lib/setupDocuments/storage");
  const pdfBytes = await readBytesFromStorageRef(blank.setupDocument.storagePath);
  const extraction = await extractPdfFormFields(Buffer.from(pdfBytes));
  if (!extraction.hasFormFields) {
    throw new Error(`blank ${blank.id} has no form layer: ${extraction.loadError ?? "unknown"}`);
  }

  // Same call the upload door makes, same label, so this row ends up indistinguishable from one
  // created fresh today. That equality is the point: the fingerprint below only means anything if
  // the two derivations really are the same derivation.
  const derived = deriveSchemaFromAcroForm(extraction, model.name);
  const newByKey = new Map(derived.schema.fields.map((f) => [f.key, f] as const));

  const keysAdded = [...newByKey.keys()].filter((k) => !oldByKey.has(k));
  const keysRemoved = [...oldByKey.keys()].filter((k) => !newByKey.has(k));

  let becameCheckbox = 0;
  for (const [key, next] of newByKey) {
    const before = oldByKey.get(key);
    if (before && before.uiType !== "checkbox" && next.uiType === "checkbox") becameCheckbox += 1;
  }
  const choiceGroupsFormed = derived.schema.fields.filter(
    (f) => (f.groupedOptionLabels?.length ?? 0) > 0 && !oldByKey.get(f.key)?.groupedOptionLabels?.length
  ).length;

  // What the re-derivation costs, counted on the real rows rather than assumed. A snapshot on a car
  // of this chassis that holds a value under a key the corrected sheet no longer declares keeps the
  // value in its JSON, but nothing draws it and nothing exports it.
  const keysLosingValues: Array<{ key: string; snapshotCount: number }> = [];
  if (keysRemoved.length > 0) {
    const cars = await prisma.car.findMany({
      where: { setupSheetModelId: model.id },
      select: { id: true },
    });
    if (cars.length > 0) {
      const snapshots = await prisma.setupSnapshot.findMany({
        where: { carId: { in: cars.map((c) => c.id) } },
        select: { data: true },
      });
      for (const key of keysRemoved) {
        const count = snapshots.filter((s) => {
          const data = s.data as Record<string, unknown> | null;
          const v = data?.[key];
          return v !== undefined && v !== null && v !== "";
        }).length;
        if (count > 0) keysLosingValues.push({ key, snapshotCount: count });
      }
      keysLosingValues.sort((a, b) => b.snapshotCount - a.snapshotCount);
    }
  }

  const nextSlug = derivedSheetSlug(derivedSheetFingerprint(derived));
  const slugOwner =
    nextSlug === model.slug
      ? null
      : await prisma.setupSheetModel.findUnique({ where: { slug: nextSlug }, select: { id: true } });
  const slugTakenByOtherModel = Boolean(slugOwner && slugOwner.id !== model.id);

  const result: RederiveResult = {
    modelId: model.id,
    name: model.name,
    slug: model.slug,
    nextSlug,
    slugTakenByOtherModel,
    boxCountBefore: Array.isArray(blank.boxesJson) ? blank.boxesJson.length : 0,
    boxCountAfter: derived.boxes.length,
    becameCheckbox,
    choiceGroupsFormed,
    keysAdded,
    keysRemoved,
    keysLosingValues,
    applied: false,
  };
  if (!input.apply) return result;

  const calibrationData = (model.defaultCalibration?.calibrationDataJson ?? {}) as Record<
    string,
    unknown
  >;
  const nextCalibrationData = {
    ...calibrationData,
    formFieldMappings: derived.formFieldMappings as Record<string, PdfFormFieldMappingRule>,
  };

  // One transaction: a schema whose keys no longer match the boxes draws a sheet with holes in it,
  // and a calibration still mapping the old keys imports into parameters that no longer exist.
  await prisma.$transaction([
    prisma.setupSheetModel.update({
      where: { id: model.id },
      data: {
        schemaJson: JSON.parse(JSON.stringify(derived.schema)),
        ...(slugTakenByOtherModel || nextSlug === model.slug ? {} : { slug: nextSlug }),
      },
    }),
    ...(model.defaultCalibration
      ? [
          prisma.setupSheetCalibration.update({
            where: { id: model.defaultCalibration.id },
            data: { calibrationDataJson: JSON.parse(JSON.stringify(nextCalibrationData)) },
          }),
        ]
      : []),
    prisma.setupSheetBlank.update({
      where: { id: blank.id },
      data: {
        boxesJson: JSON.parse(JSON.stringify(derived.boxes)),
        statsJson: JSON.parse(JSON.stringify(derived.stats)),
        fillSurface: derived.boxes.length > 0 ? "sheet" : "form",
      },
    }),
  ]);

  // The picture is drawn from the boxes, so it is stale the moment they change. Never throws.
  await prerenderSheetPages(model.id);

  return { ...result, applied: true, slug: slugTakenByOtherModel ? model.slug : nextSlug };
}

/** Every chassis a driver's own PDF created, oldest first. The set this repair applies to. */
export async function listDerivedChassis(): Promise<Array<{ id: string; name: string; slug: string }>> {
  const rows = await prisma.setupSheetModel.findMany({
    where: { slug: { startsWith: "sheet_" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });
  return rows;
}
