import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tireSets = await prisma.tireSet.findMany({
    where: { userId: user.id },
    orderBy: [{ label: "asc" }, { setNumber: "asc" }, { createdAt: "desc" }],
    select: { id: true, label: true, setNumber: true, initialRunCount: true },
  });
  return NextResponse.json({ tireSets });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as {
      label?: string;
      setNumber?: number;
      initialRunCount?: number;
      notes?: string;
    };

    const label = body.label?.trim();
    if (!label) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }

    const setNumber =
      typeof body.setNumber === "number" && Number.isFinite(body.setNumber) && body.setNumber >= 1
        ? Math.floor(body.setNumber)
        : 1;

    const initialRunCount =
      typeof body.initialRunCount === "number" && Number.isFinite(body.initialRunCount) && body.initialRunCount >= 0
        ? Math.floor(body.initialRunCount)
        : 0;

    const tireSet = await prisma.tireSet.create({
      data: {
        label,
        setNumber,
        initialRunCount,
        notes: body.notes?.trim() || null,
        userId: user.id,
      },
      select: { id: true, label: true, setNumber: true, initialRunCount: true, notes: true },
    });

    return NextResponse.json({ tireSet }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create tire set";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

