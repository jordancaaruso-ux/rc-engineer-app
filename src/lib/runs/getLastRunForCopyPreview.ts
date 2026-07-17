import { prisma } from "@/lib/prisma";
import { withIncludedBestLapForPicker } from "@/lib/lapAnalysis";

/** Last completed-or-any run for the copy-last-run card (matches /api/runs/last-any). */
export async function getLastRunForCopyPreview(userId: string) {
  const run = await prisma.run.findFirst({
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
      trackLayoutId: true,
      trackDirection: true,
      eventId: true,
      tireSetId: true,
      tireRunNumber: true,
      additiveTypeId: true,
      warmerTimingMinutes: true,
      tirePrep: true,
      practiceDayUrl: true,
      lapTimes: true,
      lapSession: true,
      bestLapSeconds: true,
      car: { select: { id: true, name: true } },
      track: { select: { id: true, name: true } },
      trackLayout: { select: { id: true, name: true } },
      tireSet: { select: { id: true, label: true, setNumber: true } },
      additiveType: { select: { id: true, displayName: true, modelCode: true } },
      event: { select: { id: true, name: true, endDate: true } },
      setupSnapshot: { select: { id: true, data: true } },
    },
  });
  // Exclusion-aware best lap; the lapSession blob stays server-side.
  return run ? withIncludedBestLapForPicker(run) : null;
}

export type { CopyPreviewRunRecord } from "@/lib/runs/copyPreviewRunTypes";
