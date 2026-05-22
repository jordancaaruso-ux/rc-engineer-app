import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { buildGenericPresetSchema } from "@/lib/setupSheetModels/genericPresetSchema";
import { slugifySetupSheetModelName, uniqueSlugCandidate } from "@/lib/setupSheetModels/slug";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { ensureA800SetupSheetModelForUser } from "@/lib/setupSheetModels/seedA800Model";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureA800SetupSheetModelForUser(user.id);

  const models = await prisma.setupSheetModel.findMany({
    where: { userId: user.id },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { cars: true, calibrations: true } },
    },
  });

  return NextResponse.json({
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      carCount: m._count.cars,
      calibrationCount: m._count.calibrations,
    })),
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

  const existingSlugs = new Set(
    (
      await prisma.setupSheetModel.findMany({
        where: { userId: user.id },
        select: { slug: true },
      })
    ).map((r) => r.slug)
  );
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
