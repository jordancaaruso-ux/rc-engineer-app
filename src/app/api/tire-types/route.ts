import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { matchTireTypes, suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";
import { ensureSeedTireTypes } from "@/lib/tires/ensureSeedTireTypes";

const TIRE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
} as const;

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const take = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 50) || 50));

  const count = await prisma.tireType.count();
  if (count === 0) {
    await ensureSeedTireTypes();
  }

  if (q.length >= 1) {
    const catalog = await prisma.tireType.findMany({
      select: TIRE_TYPE_SELECT,
      orderBy: [{ displayName: "asc" }],
      take: 200,
    });
    const matches = matchTireTypes(q, catalog, take);
    return NextResponse.json({
      tireTypes: matches.map((m) => m.tireType),
      query: q,
    });
  }

  const tireTypes = await prisma.tireType.findMany({
    select: TIRE_TYPE_SELECT,
    orderBy: [{ displayName: "asc" }],
    take,
  });
  return NextResponse.json({ tireTypes });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as {
      displayName?: string;
      modelCode?: string;
    };

    const displayName = body.displayName?.trim();
    if (!displayName) {
      return NextResponse.json({ error: "displayName is required" }, { status: 400 });
    }

    const modelCodeRaw = body.modelCode?.trim() || suggestModelCodeFromDisplayName(displayName);
    const modelCode = modelCodeRaw.toUpperCase().replace(/\s+/g, "-");

    const existingByCode = await prisma.tireType.findUnique({
      where: { modelCode },
      select: TIRE_TYPE_SELECT,
    });
    if (existingByCode) {
      return NextResponse.json(
        {
          error: "A tire type with this model code already exists.",
          existing: existingByCode,
        },
        { status: 409 }
      );
    }

    const catalog = await prisma.tireType.findMany({
      select: TIRE_TYPE_SELECT,
      take: 200,
      orderBy: { displayName: "asc" },
    });
    const nearMatches = matchTireTypes(displayName, catalog, 4).filter((m) => m.score >= 70);

    const tireType = await prisma.tireType.create({
      data: {
        displayName,
        modelCode,
        createdByUserId: user.id,
      },
      select: TIRE_TYPE_SELECT,
    });

    return NextResponse.json({ tireType, nearMatches: nearMatches.map((m) => m.tireType) }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create tire type";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
