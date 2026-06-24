import { prisma } from "@/lib/prisma";

/** Last completed-or-any run for the copy-last-run card (matches /api/runs/last-any). */
export async function getLastRunForCopyPreview(userId: string) {
  return prisma.run.findFirst({
    where: { userId },
    orderBy: { sortAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      sessionLabel: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      carId: true,
      carNameSnapshot: true,
      trackId: true,
      trackNameSnapshot: true,
      eventId: true,
      tireSetId: true,
      tireRunNumber: true,
      additiveTypeId: true,
      warmerTimingMinutes: true,
      batteryId: true,
      batteryRunNumber: true,
      practiceDayUrl: true,
      lapTimes: true,
      car: { select: { id: true, name: true } },
      track: { select: { id: true, name: true } },
      tireSet: { select: { id: true, label: true, setNumber: true } },
      additiveType: { select: { id: true, displayName: true, modelCode: true } },
      battery: { select: { id: true, label: true, packNumber: true } },
      event: { select: { id: true, name: true } },
      setupSnapshot: { select: { id: true, data: true } },
    },
  });
}

export type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";
