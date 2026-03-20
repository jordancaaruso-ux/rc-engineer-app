import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET(
  _request: Request,
  context: { params: Promise<{ carId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const user = await getOrCreateLocalUser();
  const { carId } = await context.params;

  const tireSets = await prisma.tireSet.findMany({
    where: { userId: user.id, carId },
    orderBy: [{ label: "asc" }, { setNumber: "asc" }, { createdAt: "desc" }],
    select: { id: true, label: true, setNumber: true, initialRunCount: true }
  });

  return NextResponse.json({ tireSets });
}

