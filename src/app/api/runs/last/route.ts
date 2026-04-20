import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { carIdsSharingSetupTemplate } from "@/lib/carSetupScope";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId");

  if (!carId) {
    return NextResponse.json({ error: "carId is required" }, { status: 400 });
  }

  const scopeCarIds = await carIdsSharingSetupTemplate(user.id, carId);

  const baseInclude = {
    track: { select: { id: true, name: true } },
    tireSet: { select: { id: true, label: true, setNumber: true } },
    battery: { select: { id: true, label: true, packNumber: true } },
    event: { select: { id: true, name: true, trackId: true, startDate: true, endDate: true } },
    setupSnapshot: { select: { id: true, data: true } },
  } as const;

  // Prefer the most recently COMPLETED run for prefill / copy-run.
  // If the driver saved a draft but never hit "Run completed", that draft's
  // in-progress edits shouldn't become the new run's starting point.
  // Fall back to any run on this car (or shared-template car) if no completed
  // run exists yet.
  const completedRun = await prisma.run.findFirst({
    where: {
      userId: user.id,
      carId: { in: scopeCarIds },
      loggingComplete: true,
    },
    orderBy: { sortAt: "desc" },
    include: baseInclude,
  });

  const lastRun =
    completedRun ??
    (await prisma.run.findFirst({
      where: { userId: user.id, carId: { in: scopeCarIds } },
      orderBy: { sortAt: "desc" },
      include: baseInclude,
    }));

  return NextResponse.json({ lastRun });
}

