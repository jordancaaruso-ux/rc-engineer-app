import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { canManageCalibration } from "@/lib/setupCalibrations/calibrationAccess";
import { normalizeSetupSheetModelSchemaFields } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import { SETUP_SHEET_MODEL_SLUG_A800RR } from "@/lib/setupSheetModels/seedA800Model";
import { parseSetupSheetModelSchema, type SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

function normalizeSchema(schema: SetupSheetModelSchema | null): SetupSheetModelSchema | null {
  if (!schema) return null;
  return { ...schema, fields: normalizeSetupSheetModelSchemaFields(schema.fields) };
}

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Models are global. Only an admin — or the creator while the model is still unauthorized — may
 * edit a shared model's name/schema or delete it. Authorizing a model is admin-only.
 */
function canEditModel(
  user: { id: string; email: string | null },
  model: { userId: string | null; isAuthorized: boolean }
): boolean {
  if (isAuthAdminEmail(user.email)) return true;
  return model.userId === user.id && !model.isAuthorized;
}

export async function GET(_request: Request, ctx: RouteCtx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const model = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      schemaJson: true,
      isAuthorized: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!model) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const schema = normalizeSchema(parseSetupSheetModelSchema(model.schemaJson));
  return NextResponse.json({
    model: {
      id: model.id,
      name: model.name,
      slug: model.slug,
      schema,
      isAuthorized: model.isAuthorized,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    },
  });
}

export async function PATCH(request: Request, ctx: RouteCtx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: { id: true, slug: true, userId: true, isAuthorized: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as {
    name?: string;
    schema?: unknown;
    defaultCalibrationId?: string | null;
    isAuthorized?: boolean;
  };
  const isAdmin = isAuthAdminEmail(user.email);

  // Name/schema edits to a shared model require admin, or the creator while it's still unauthorized.
  const editsSharedShape = Boolean(body.name?.trim()) || body.schema !== undefined;
  if (editsSharedShape && !canEditModel(user, existing)) {
    return NextResponse.json(
      { error: "This chassis type is shared. Only an admin can change its name or parameters." },
      { status: 403 }
    );
  }

  const data: {
    name?: string;
    schemaJson?: object;
    defaultCalibrationId?: string | null;
    isAuthorized?: boolean;
  } = {};
  if (body.name?.trim()) data.name = body.name.trim();
  if (typeof body.isAuthorized === "boolean") {
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only an admin can change a chassis type's authorized status." },
        { status: 403 }
      );
    }
    data.isAuthorized = body.isAuthorized;
  }
  if ("defaultCalibrationId" in body) {
    const raw = body.defaultCalibrationId;
    if (raw === null || raw === "") {
      data.defaultCalibrationId = null;
    } else if (typeof raw === "string" && raw.trim()) {
      const calId = raw.trim();
      const cal = await prisma.setupSheetCalibration.findFirst({
        where: {
          id: calId,
          OR: [{ setupSheetModelId: id }, { setupSheetModelId: null }],
        },
        select: { id: true, userId: true, setupSheetModelId: true },
      });
      if (!cal) {
        return NextResponse.json(
          { error: "Calibration not found or not for this sheet model" },
          { status: 400 }
        );
      }
      if (!canManageCalibration(user, cal)) {
        return NextResponse.json(
          { error: "Only the calibration creator or an admin can set it as the chassis default." },
          { status: 403 }
        );
      }
      data.defaultCalibrationId = calId;
      if (!cal.setupSheetModelId) {
        await prisma.setupSheetCalibration.update({
          where: { id: calId },
          data: { setupSheetModelId: id },
        });
      }
    }
  }

  if (body.schema !== undefined) {
    const parsed = parseSetupSheetModelSchema(body.schema);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid schema" }, { status: 400 });
    }
    data.schemaJson = parsed as object;
  }

  const model = await prisma.setupSheetModel.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      slug: true,
      schemaJson: true,
      isAuthorized: true,
      updatedAt: true,
    },
  });

  const schema = normalizeSchema(parseSetupSheetModelSchema(model.schemaJson));
  revalidatePath("/cars");
  revalidatePath(`/setup-sheet-models/${id}/schema`);
  revalidatePath("/setup");
  revalidatePath("/setup-sheet-models");
  return NextResponse.json({
    model: {
      id: model.id,
      name: model.name,
      slug: model.slug,
      schema,
      isAuthorized: model.isAuthorized,
      updatedAt: model.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await prisma.setupSheetModel.findUnique({
    where: { id },
    select: { id: true, slug: true, name: true, userId: true, isAuthorized: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!canEditModel(user, existing)) {
    return NextResponse.json(
      { error: "This chassis type is shared. Only an admin can delete it." },
      { status: 403 }
    );
  }

  if (existing.slug === SETUP_SHEET_MODEL_SLUG_A800RR) {
    return NextResponse.json(
      { error: "The built-in Awesomatix A800 chassis type cannot be deleted." },
      { status: 400 }
    );
  }

  await prisma.setupSheetModel.delete({ where: { id } });

  revalidatePath("/cars");
  revalidatePath("/setup");
  revalidatePath("/setup-sheet-models");
  revalidatePath(`/setup-sheet-models/${id}/schema`);
  return NextResponse.json({ ok: true, deletedId: id, name: existing.name });
}
