import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSheetModelSchemaFields } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import { SETUP_SHEET_MODEL_SLUG_A800RR } from "@/lib/setupSheetModels/seedA800Model";
import { parseSetupSheetModelSchema, type SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

function normalizeSchema(schema: SetupSheetModelSchema | null): SetupSheetModelSchema | null {
  if (!schema) return null;
  return { ...schema, fields: normalizeSetupSheetModelSchemaFields(schema.fields) };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const model = await prisma.setupSheetModel.findFirst({
    where: { id, userId: user.id },
    select: { id: true, name: true, slug: true, schemaJson: true, createdAt: true, updatedAt: true },
  });
  if (!model) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const schema = normalizeSchema(parseSetupSheetModelSchema(model.schemaJson));
  return NextResponse.json({
    model: {
      id: model.id,
      name: model.name,
      slug: model.slug,
      schema,
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

  const existing = await prisma.setupSheetModel.findFirst({
    where: { id, userId: user.id },
    select: { id: true, slug: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as {
    name?: string;
    schema?: unknown;
    defaultCalibrationId?: string | null;
  };
  const data: { name?: string; schemaJson?: object; defaultCalibrationId?: string | null } = {};
  if (body.name?.trim()) data.name = body.name.trim();
  if ("defaultCalibrationId" in body) {
    const raw = body.defaultCalibrationId;
    if (raw === null || raw === "") {
      data.defaultCalibrationId = null;
    } else if (typeof raw === "string" && raw.trim()) {
      const calId = raw.trim();
      const cal = await prisma.setupSheetCalibration.findFirst({
        where: {
          id: calId,
          userId: user.id,
          OR: [{ setupSheetModelId: id }, { setupSheetModelId: null }],
        },
        select: { id: true, setupSheetModelId: true },
      });
      if (!cal) {
        return NextResponse.json(
          { error: "Calibration not found or not for this sheet model" },
          { status: 400 }
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
    select: { id: true, name: true, slug: true, schemaJson: true, updatedAt: true },
  });

  const schema = normalizeSchema(parseSetupSheetModelSchema(model.schemaJson));
  revalidatePath("/cars");
  revalidatePath(`/setup-sheet-models/${id}/schema`);
  revalidatePath("/setup");
  return NextResponse.json({
    model: {
      id: model.id,
      name: model.name,
      slug: model.slug,
      schema,
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

  const existing = await prisma.setupSheetModel.findFirst({
    where: { id, userId: user.id },
    select: { id: true, slug: true, name: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
