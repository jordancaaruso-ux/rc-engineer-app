import { prisma } from "@/lib/prisma";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { displayRunNotes } from "@/lib/runNotes";

/** Serializable snapshot for engineer / workflow UI (no Prisma types in client props). */
export type EngineerWorkflowContext = {
  lastRun: null | {
    id: string;
    createdAtIso: string;
    createdAtLabel: string;
    sessionSummary: string;
    carName: string;
    trackName: string;
    eventName: string | null;
    notesPreview: string;
  };
  thingsToTry: { id: string; text: string }[];
};

/**
 * Latest saved run + active “things to try” for the current user.
 * Used as Phase-2 foundation for engineer / decision workflow context.
 */
export async function loadEngineerWorkflowContext(userId: string): Promise<EngineerWorkflowContext> {
  const [lastRun, thingsToTry] = await Promise.all([
    prisma.run.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        sessionType: true,
        meetingSessionType: true,
        meetingSessionCode: true,
        sessionLabel: true,
        carNameSnapshot: true,
        trackNameSnapshot: true,
        notes: true,
        driverNotes: true,
        handlingProblems: true,
        car: { select: { name: true } },
        track: { select: { name: true } },
        event: { select: { name: true } },
      },
    }),
    prisma.actionItem.findMany({
      where: { userId, isArchived: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, text: true },
    }),
  ]);

  if (!lastRun) {
    return { lastRun: null, thingsToTry };
  }

  const carName = lastRun.car?.name ?? lastRun.carNameSnapshot ?? "—";
  const trackName = lastRun.track?.name ?? lastRun.trackNameSnapshot ?? "—";
  const notesPreview = displayRunNotes({
    notes: lastRun.notes,
    driverNotes: lastRun.driverNotes,
    handlingProblems: lastRun.handlingProblems,
  }).trim();

  return {
    lastRun: {
      id: lastRun.id,
      createdAtIso: lastRun.createdAt.toISOString(),
      createdAtLabel: formatRunCreatedAtDateTime(lastRun.createdAt),
      sessionSummary: formatRunSessionDisplay({
        sessionType: lastRun.sessionType,
        meetingSessionType: lastRun.meetingSessionType,
        meetingSessionCode: lastRun.meetingSessionCode,
        sessionLabel: lastRun.sessionLabel,
      }),
      carName,
      trackName,
      eventName: lastRun.event?.name ?? null,
      notesPreview: notesPreview.length > 220 ? `${notesPreview.slice(0, 217)}…` : notesPreview || "—",
    },
    thingsToTry,
  };
}
