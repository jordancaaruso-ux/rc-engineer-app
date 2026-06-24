import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";
import { ensureSeedAdditiveTypes } from "@/lib/additives/ensureSeedAdditiveTypes";

const ADDITIVE_TYPE_SELECT = {
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

  const count = await prisma.additiveType.count();
  if (count === 0) {
    await ensureSeedAdditiveTypes();
  }

  if (q.length >= 1) {
    const additiveTypes = await prisma.additiveType.findMany({
      where: {
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { modelCode: { contains: q, mode: "insensitive" } },
        ],
      },
      select: ADDITIVE_TYPE_SELECT,
      orderBy: [{ displayName: "asc" }],
      take,
    });
    return NextResponse.json({ additiveTypes, query: q });
  }

  const additiveTypes = await prisma.additiveType.findMany({
    select: ADDITIVE_TYPE_SELECT,
    orderBy: [{ displayName: "asc" }],
    take,
  });
  return NextResponse.json({ additiveTypes });
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

    const existingByCode = await prisma.additiveType.findUnique({
      where: { modelCode },
      select: ADDITIVE_TYPE_SELECT,
    });
    if (existingByCode) {
      return NextResponse.json(
        {
          error: "An additive type with this model code already exists.",
          existing: existingByCode,
        },
        { status: 409 }
      );
    }

    const additiveType = await prisma.additiveType.create({
      data: {
        displayName,
        modelCode,
        createdByUserId: user.id,
      },
      select: ADDITIVE_TYPE_SELECT,
    });

    return NextResponse.json({ additiveType }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create additive type";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
