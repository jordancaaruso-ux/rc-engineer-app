import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const batteries = await prisma.battery.findMany({
    where: { userId: user.id },
    orderBy: [{ label: "asc" }, { packNumber: "asc" }, { createdAt: "desc" }],
    select: { id: true, label: true, packNumber: true, initialRunCount: true },
  });
  return NextResponse.json({ batteries });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    const user = await getOrCreateLocalUser();
    const body = (await request.json()) as {
      label?: string;
      packNumber?: number;
      initialRunCount?: number;
      notes?: string;
    };

    const label = body.label?.trim();
    if (!label) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }

    const packNumber =
      typeof body.packNumber === "number" && Number.isFinite(body.packNumber) && body.packNumber >= 1
        ? Math.floor(body.packNumber)
        : 1;

    const initialRunCount =
      typeof body.initialRunCount === "number" && Number.isFinite(body.initialRunCount) && body.initialRunCount >= 0
        ? Math.floor(body.initialRunCount)
        : 0;

    const battery = await prisma.battery.create({
      data: {
        label,
        packNumber,
        initialRunCount,
        notes: body.notes?.trim() || null,
        userId: user.id,
      },
      select: { id: true, label: true, packNumber: true, initialRunCount: true, notes: true },
    });

    return NextResponse.json({ battery }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create battery";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
