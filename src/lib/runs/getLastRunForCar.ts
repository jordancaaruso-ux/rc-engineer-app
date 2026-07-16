import { prisma } from "@/lib/prisma";
import { toEntryCandidate, type EntryCandidate } from "@/lib/runs/entryCandidate";

/**
 * The most recent run the driver logged on a specific car — the source the
 * Log-run entry screen continues from once the driver picks that car
 * ("last run of the car you pick"). Scoped to the user's own runs.
 */
export async function getLastRunForCar(userId: string, carId: string): Promise<EntryCandidate | null> {
  const row = await prisma.run.findFirst({
    where: { userId, carId },
    orderBy: { sortAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      carId: true,
      carNameSnapshot: true,
      trackId: true,
      trackNameSnapshot: true,
      eventId: true,
      meetingSessionType: true,
      sessionLabel: true,
      car: { select: { id: true, name: true } },
      track: { select: { id: true, name: true } },
      event: { select: { id: true, name: true, endDate: true } },
    },
  });
  return toEntryCandidate(row);
}
