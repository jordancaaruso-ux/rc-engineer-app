import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { carIdsSharingSetupTemplate } from "@/lib/carSetupScope";
import { unfinishedRunToCarrySetupFrom } from "@/lib/runs/prefillSetupSource";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId");

  if (!carId) {
    return NextResponse.json({ error: "carId is required" }, { status: 400 });
  }

  const scopeCarIds = await carIdsSharingSetupTemplate(userId, carId);

  const baseInclude = {
    track: { select: { id: true, name: true } },
    trackLayout: { select: { id: true, name: true } },
    // Scalars are NOT listed here: `include` takes relations only, and Prisma throws on a scalar
    // key. Every scalar on Run (tireStintId, tireAgeKnown, …) is returned by default anyway.
    tireType: { select: { id: true, displayName: true } },
    event: { select: { id: true, name: true, trackId: true, startDate: true, endDate: true } },
    setupSnapshot: { select: { id: true, data: true } },
  } as const;

  // Prefer the most recently COMPLETED run for prefill / copy-run.
  // If the driver saved a draft but never hit "Run completed", that draft's
  // in-progress edits shouldn't become the new run's starting point.
  // Fall back to any run on this car (or shared-template car) if no completed
  // run exists yet.
  //
  // THE SETUP IS THE EXCEPTION, and `prefillSetupSource` says why: screws are where the
  // driver last put them whether or not the log entry about it was finished, so a draft
  // sitting in front of the last completed run still hands its setup forward. Skipping it
  // silently threw away a paying driver's sheet edit (reproduced 2026-08-25).
  const [completedRun, newestRun] = await Promise.all([
    prisma.run.findFirst({
      where: {
        userId: userId,
        carId: { in: scopeCarIds },
        loggingComplete: true,
      },
      orderBy: { sortAt: "desc" },
      include: baseInclude,
    }),
    prisma.run.findFirst({
      where: { userId: userId, carId: { in: scopeCarIds } },
      orderBy: { sortAt: "desc" },
      include: baseInclude,
    }),
  ]);

  const baseRun = completedRun ?? newestRun;
  const carrySetupFrom = unfinishedRunToCarrySetupFrom({
    completed: completedRun,
    newest: newestRun,
  });

  const lastRun =
    baseRun && carrySetupFrom?.setupSnapshot
      ? { ...baseRun, setupSnapshot: carrySetupFrom.setupSnapshot }
      : baseRun;

  return NextResponse.json({
    lastRun,
    // So the prefill card can say whose setup this is rather than quietly implying it
    // came from the run it named. Null whenever the setup and the context agree.
    setupFromUnfinishedRun: carrySetupFrom
      ? {
          id: carrySetupFrom.id,
          whenIso: carrySetupFrom.sortAt.toISOString(),
          sessionLabel: carrySetupFrom.sessionLabel ?? null,
        }
      : null,
  });
}

