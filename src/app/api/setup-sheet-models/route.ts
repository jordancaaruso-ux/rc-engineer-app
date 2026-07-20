import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { buildGenericPresetSchema } from "@/lib/setupSheetModels/genericPresetSchema";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { dedupeSetupSheetModelsForPicker } from "@/lib/setupSheetModels/pickerModels";
import { slugifySetupSheetModelName, uniqueSlugCandidate } from "@/lib/setupSheetModels/slug";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { ensureAuthorizedSetupSheetCatalog } from "@/lib/setupSheetModels/seedAuthorizedCatalog";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { draftedSchemaToModelSchema } from "@/lib/setupExtractAi/draftedSchemaToModelSchema";
import type { DraftedField } from "@/lib/setupExtractAi/draftSetupSheetModelSchema";
import { verifiedAtForNewCalibration } from "@/lib/setupCalibrations/calibrationAccess";
import { assessBlankSheetCalibrationFit } from "@/lib/setupSheetModels/blankSheetCalibrationFit";
import { isPdfFormFieldMappingRule, normalizePdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureAuthorizedSetupSheetCatalog();

  // Models are global (shared across users) — list them all, authorized first.
  const models = await prisma.setupSheetModel.findMany({
    orderBy: [{ isAuthorized: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      isAuthorized: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { cars: true, calibrations: true } },
    },
  });

  const authById = new Map(models.map((m) => [m.id, m.isAuthorized] as const));
  return NextResponse.json({
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      isAuthorized: m.isAuthorized,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      carCount: m._count.cars,
      calibrationCount: m._count.calibrations,
    })),
    pickerModels: dedupeSetupSheetModelsForPicker(
      models.map((m) => ({
        id: m.id,
        name: m.name,
        slug: m.slug,
        carCount: m._count.cars,
        calibrationCount: m._count.calibrations,
      }))
    ).map((m) => ({ ...m, isAuthorized: authById.get(m.id) ?? false })),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    name?: string;
    seedFromGenericPreset?: boolean;
    schema?: unknown;
    /** AcroForm-anchored AI draft (from /draft-from-pdf), converted to a schema server-side. */
    draftedFields?: DraftedField[];
    /** SetupDocument id of the blank AcroForm stored by /draft-from-pdf. */
    exampleDocumentId?: string | null;
    /** Drafted key → AcroForm read rule, from the same /draft-from-pdf response. */
    formFieldMappings?: Record<string, unknown>;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Models are global: reuse an existing chassis (authorized first) by normalized name so two users
  // adding "Mugen MTC3" share one row instead of creating per-user duplicates.
  const norm = normalizeSetupSheetModelName(name);
  const existingRows = await prisma.setupSheetModel.findMany({
    orderBy: [{ isAuthorized: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, slug: true },
  });
  const existingByName = existingRows.find((m) => normalizeSetupSheetModelName(m.name) === norm);
  if (existingByName) {
    // Repair path: models created before the wizard shipped calibrations (and any whose
    // calibration was never authored) are unreadable — every upload of their sheet imports blank.
    // Re-running the wizard with the same PDF attaches the missing calibration in place.
    const repair = await repairMissingCalibration({
      user,
      modelId: existingByName.id,
      modelName: existingByName.name,
      exampleDocumentId: body.exampleDocumentId ?? null,
      rawMappings: body.formFieldMappings,
    });
    revalidatePath("/cars");
    revalidatePath("/setup-sheet-models");
    return NextResponse.json({
      model: existingByName,
      reused: true,
      calibrationId: repair.calibrationId,
      calibrationNote: repair.note,
    });
  }

  // Creating a brand-new chassis type (a global, shared setup sheet) is admin-only — the catalog is
  // curated founder ground truth. Non-admins pick from existing types or mark a car "pending".
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "Only an admin can create a new chassis type. Pick an existing one, or leave it unset for now." },
      { status: 403 }
    );
  }

  const existingSlugs = new Set(existingRows.map((r) => r.slug));
  const slug = uniqueSlugCandidate(slugifySetupSheetModelName(name), existingSlugs);

  let schemaJson: object;
  if (body.schema) {
    const parsed = parseSetupSheetModelSchema(body.schema);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid schema" }, { status: 400 });
    }
    schemaJson = parsed as object;
  } else if (Array.isArray(body.draftedFields) && body.draftedFields.length > 0) {
    const parsed = parseSetupSheetModelSchema(
      draftedSchemaToModelSchema({ carName: name, fields: body.draftedFields })
    );
    if (!parsed) {
      return NextResponse.json({ error: "Invalid drafted fields" }, { status: 400 });
    }
    schemaJson = parsed as object;
  } else {
    const schema = buildGenericPresetSchema(name);
    schemaJson = schema as object;
  }

  const model = await prisma.setupSheetModel.create({
    data: {
      userId: user.id,
      name,
      slug,
      schemaJson,
    },
    select: { id: true, name: true, slug: true },
  });

  // Ship the model with a working AcroForm calibration. A sheet model on its own only names the
  // fields — without a calibration (and an example PDF to fingerprint) auto-pick can never match
  // an upload of this sheet, so every import of it came back blank.
  const calibrationId = await createBlankSheetCalibration({
    userId: user.id,
    userEmail: user.email,
    modelId: model.id,
    modelName: name,
    exampleDocumentId: body.exampleDocumentId ?? null,
    rawMappings: body.formFieldMappings,
    // Only map fields the driver kept in review.
    keepKeys: new Set((body.draftedFields ?? []).map((f) => f.key)),
  });

  revalidatePath("/cars");
  revalidatePath("/setup-sheet-models");
  return NextResponse.json({ model, calibrationId }, { status: 201 });
}

/**
 * Attach a calibration to an EXISTING sheet model that has none. Deliberately conservative — this
 * mutates a globally shared row, so it is admin-only, refuses when any calibration already exists
 * (never competes with authored work), and refuses when the uploaded PDF doesn't actually look
 * like this model's sheet. Returns a note explaining every refusal rather than failing silently.
 */
async function repairMissingCalibration(input: {
  user: { id: string; email: string | null };
  modelId: string;
  modelName: string;
  exampleDocumentId: string | null;
  rawMappings: Record<string, unknown> | undefined;
}): Promise<{ calibrationId: string | null; note: string | null }> {
  if (!input.exampleDocumentId?.trim() || !input.rawMappings) {
    return { calibrationId: null, note: null };
  }
  const model = await prisma.setupSheetModel.findUnique({
    where: { id: input.modelId },
    select: { schemaJson: true, defaultCalibrationId: true, _count: { select: { calibrations: true } } },
  });
  if (!model) return { calibrationId: null, note: null };

  // Healthy-model check first: nothing needs repairing, so don't talk about permissions.
  if (model._count.calibrations > 0 || model.defaultCalibrationId) {
    return {
      calibrationId: null,
      note: "This chassis type already exists and already has a calibration — it was left untouched.",
    };
  }
  if (!isAuthAdminEmail(input.user.email)) {
    return {
      calibrationId: null,
      note: "This chassis type already exists but has no calibration, so its sheets can't import automatically yet. Only an admin can attach one.",
    };
  }

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  const schemaKeys = (schema?.fields ?? []).map((f) => f.key);
  const fit = assessBlankSheetCalibrationFit(Object.keys(input.rawMappings), schemaKeys);
  if (!fit.ok) {
    return { calibrationId: null, note: `No calibration was attached. ${fit.reason}` };
  }

  const calibrationId = await createBlankSheetCalibration({
    userId: input.user.id,
    userEmail: input.user.email,
    modelId: input.modelId,
    modelName: input.modelName,
    exampleDocumentId: input.exampleDocumentId,
    rawMappings: input.rawMappings,
    // Only map fields this model actually defines — extra PDF fields would import values the
    // model can't display.
    keepKeys: new Set(fit.matchedKeys),
  });
  return {
    calibrationId,
    note: calibrationId
      ? `Calibration attached to the existing “${input.modelName}”. ${fit.reason}`
      : "No calibration was attached — the uploaded PDF produced no usable field mappings.",
  };
}

/**
 * Create the PDF calibration for a freshly drafted sheet model. Returns null (never throws) when
 * there is nothing usable to build from — the model is already created and is still useful, so a
 * missing calibration degrades to the previous "map it by hand later" behaviour.
 */
async function createBlankSheetCalibration(input: {
  userId: string;
  userEmail: string | null;
  modelId: string;
  modelName: string;
  exampleDocumentId: string | null;
  rawMappings: Record<string, unknown> | undefined;
  keepKeys: Set<string>;
}): Promise<string | null> {
  const exampleDocumentId = input.exampleDocumentId?.trim() || null;
  if (!exampleDocumentId || !input.rawMappings) return null;

  // The example must be a document this user just uploaded — never trust a client-supplied id
  // pointing at someone else's sheet.
  const doc = await prisma.setupDocument.findFirst({
    where: { id: exampleDocumentId, userId: input.userId },
    select: { id: true },
  });
  if (!doc) return null;

  const formFieldMappings: Record<string, PdfFormFieldMappingRule> = {};
  for (const [key, rule] of Object.entries(input.rawMappings)) {
    if (input.keepKeys.size > 0 && !input.keepKeys.has(key)) continue;
    if (!isPdfFormFieldMappingRule(rule)) continue;
    formFieldMappings[key] = normalizePdfFormFieldMappingRule(rule as PdfFormFieldMappingRule);
  }
  if (Object.keys(formFieldMappings).length === 0) return null;

  const calibration = await prisma.setupSheetCalibration.create({
    data: {
      userId: input.userId,
      name: `${input.modelName} (AcroForm)`,
      sourceType: "awesomatix_pdf",
      calibrationDataJson: {
        templateType: "pdf_form_fields",
        documentMeta: { lineGroupingEpsilon: 2.5 },
        formFieldMappings,
        fieldMappings: {},
        fields: {},
      } as object,
      exampleDocumentId,
      setupSheetModelId: input.modelId,
      verifiedAt: verifiedAtForNewCalibration({ id: input.userId, email: input.userEmail }),
    },
    select: { id: true },
  });

  await prisma.setupSheetModel.update({
    where: { id: input.modelId },
    data: { defaultCalibrationId: calibration.id },
  });
  await prisma.setupDocument.update({
    where: { id: exampleDocumentId },
    data: { setupSheetModelId: input.modelId, calibrationProfileId: calibration.id },
  });
  return calibration.id;
}
