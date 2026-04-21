import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
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
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { carId } = await context.params;

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { id: true },
  });
  if (!car) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tireSets = await prisma.tireSet.findMany({
    where: { userId: user.id },
    orderBy: [{ label: "asc" }, { setNumber: "asc" }, { createdAt: "desc" }],
    select: { id: true, label: true, setNumber: true, initialRunCount: true }
  });

  return NextResponse.json({ tireSets });
}

