import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";

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

  const schema = parseSetupSheetModelSchema(model.schemaJson);
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

  const body = (await request.json()) as { name?: string; schema?: unknown };
  const data: { name?: string; schemaJson?: object } = {};
  if (body.name?.trim()) data.name = body.name.trim();
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

  const schema = parseSetupSheetModelSchema(model.schemaJson);
  revalidatePath("/cars");
  revalidatePath(`/setup-sheet-models/${id}`);
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
