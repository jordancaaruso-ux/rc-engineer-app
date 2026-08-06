import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { canManageCalibration } from "@/lib/setupCalibrations/calibrationAccess";
import {
  canEditSetupSheetModel,
  canManageSetupSheetModel,
  type SetupSheetModelUsage,
} from "@/lib/setupSheetModels/modelAccess";
import { normalizeSetupSheetModelSchemaFields } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import {
  invalidateAuthorizedSetupSheetCatalogCache,
} from "@/lib/setupSheetModels/seedAuthorizedCatalog";
import {
  isAuthorizedCatalogSlug,
  suppressCatalogSlug,
} from "@/lib/setupSheetModels/catalogSuppression";
import { parseSetupSheetModelSchema, type SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

function normalizeSchema(schema: SetupSheetModelSchema | null): SetupSheetModelSchema | null {
  if (!schema) return null;
  return { ...schema, fields: normalizeSetupSheetModelSchemaFields(schema.fields) };
}

type RouteCtx = { params: Promise<{ id: string }> };

const canEditModel = canEditSetupSheetModel;

/**
 * Who else is standing on this chassis type. Counted per acting user, because the question is not
 * "is this in use" but "would destroying it take something that isn't mine": a driver deleting a
 * type only their own car uses is fine.
 */
async function loadModelUsage(modelId: string, actingUserId: string): Promise<SetupSheetModelUsage> {
  const notMine = { userId: { not: actingUserId } } as const;
  const [otherUserCars, otherUserFillDrafts, otherUserDocuments, otherUserCalibrations, baselineSetups] =
    await Promise.all([
      prisma.car.count({ where: { setupSheetModelId: modelId, ...notMine } }),
      prisma.setupFillDraft.count({ where: { setupSheetModelId: modelId, ...notMine } }),
      prisma.setupDocument.count({ where: { setupSheetModelId: modelId, ...notMine } }),
      prisma.setupSheetCalibration.count({ where: { setupSheetModelId: modelId, ...notMine } }),
      // Baselines are admin-published and global — there is no "mine" to exclude.
      prisma.baselineSetup.count({ where: { setupSheetModelId: modelId } }),
    ]);
  return {
    otherUserCars,
    otherUserFillDrafts,
    otherUserDocuments,
    otherUserCalibrations,
    baselineSetups,
  };
}

/** One sentence naming what is actually in the way, so the driver knows why they were stopped. */
function inUseMessage(usage: SetupSheetModelUsage, verb: string): string {
  const parts: string[] = [];
  if (usage.otherUserCars > 0) parts.push(`${usage.otherUserCars} car(s) belonging to other drivers`);
  if (usage.otherUserFillDrafts > 0) parts.push(`${usage.otherUserFillDrafts} setup(s) being filled in`);
  if (usage.otherUserDocuments > 0) parts.push(`${usage.otherUserDocuments} uploaded sheet(s)`);
  if (usage.otherUserCalibrations > 0) parts.push(`${usage.otherUserCalibrations} calibration(s)`);
  if (usage.baselineSetups > 0) parts.push(`${usage.baselineSetups} published baseline(s)`);
  const who = parts.length ? parts.join(", ") : "other drivers' data";
  return `Another driver is using this chassis type — ${who} depend on it, so it can't be ${verb}. Ask an admin to merge or retire it.`;
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

  // Rewriting the parameter list is destructive to everyone else's stored sheets: the JSON
  // survives, but values under renamed keys stop rendering, so their saved setup quietly empties.
  // A rename is safe by comparison and is not gated here.
  if (body.schema !== undefined) {
    const usage = await loadModelUsage(id, user.id);
    if (!canManageSetupSheetModel(user, existing, usage)) {
      return NextResponse.json({ error: inUseMessage(usage, "re-parameterised") }, { status: 409 });
    }
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

  // Car.setupSheetModelId is SetNull and both BaselineSetup and SetupFillDraft cascade, so a
  // delete here reaches into other people's accounts. Edit rights are not enough.
  const usage = await loadModelUsage(id, user.id);
  if (!canManageSetupSheetModel(user, existing, usage)) {
    return NextResponse.json({ error: inUseMessage(usage, "deleted") }, { status: 409 });
  }

  if (isAuthorizedCatalogSlug(existing.slug)) {
    await suppressCatalogSlug(existing.slug, user.id);
  }

  await prisma.setupSheetModel.delete({ where: { id } });
  invalidateAuthorizedSetupSheetCatalogCache();

  revalidatePath("/cars");
  revalidatePath("/setup-sheet-models");
  revalidatePath(`/setup-sheet-models/${id}/schema`);
  return NextResponse.json({ ok: true, deletedId: id, name: existing.name });
}
