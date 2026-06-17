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
    revalidatePath("/cars");
    revalidatePath("/setup-sheet-models");
    return NextResponse.json({ model: existingByName, reused: true });
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

  revalidatePath("/cars");
  revalidatePath("/setup-sheet-models");
  return NextResponse.json({ model }, { status: 201 });
}
