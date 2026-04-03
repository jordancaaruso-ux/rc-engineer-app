import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const user = await getOrCreateLocalUser();

  const lastRun = await prisma.run.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      car: { select: { id: true, name: true } },
      track: { select: { id: true, name: true } },
      tireSet: { select: { id: true, label: true, setNumber: true } },
      battery: { select: { id: true, label: true, packNumber: true } },
      event: { select: { id: true, name: true } },
      setupSnapshot: { select: { id: true, data: true } },
    },
  });

  return NextResponse.json({ lastRun });
}

