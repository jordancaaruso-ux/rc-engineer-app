import { prisma } from "@/lib/prisma";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { displayRunNotesTextOnly } from "@/lib/runNotes";
import { formatHandlingAssessmentForEngineer } from "@/lib/runHandlingAssessment";

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
    handlingPreview: string;
  };
  thingsToTry: { id: string; text: string }[];
  thingsToDo: { id: string; text: string }[];
};

/**
 * Latest saved run + active “things to try” for the current user.
 * Used as Phase-2 foundation for engineer / decision workflow context.
 */
export async function loadEngineerWorkflowContext(userId: string): Promise<EngineerWorkflowContext> {
  const [lastRun, thingsToTry, thingsToDo] = await Promise.all([
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
        handlingAssessmentJson: true,
        car: { select: { name: true } },
        track: { select: { name: true } },
        event: { select: { name: true } },
      },
    }),
    prisma.actionItem.findMany({
      where: { userId, isArchived: false, listKind: "THINGS_TO_TRY" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, text: true },
    }),
    prisma.actionItem.findMany({
      where: { userId, isArchived: false, listKind: "THINGS_TO_DO" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, text: true },
    }),
  ]);

  if (!lastRun) {
    return { lastRun: null, thingsToTry, thingsToDo };
  }

  const carName = lastRun.car?.name ?? lastRun.carNameSnapshot ?? "—";
  const trackName = lastRun.track?.name ?? lastRun.trackNameSnapshot ?? "—";
  const notesRaw = displayRunNotesTextOnly(lastRun).trim();
  const notesPreview =
    !notesRaw ? "—" : notesRaw.length > 220 ? `${notesRaw.slice(0, 217)}…` : notesRaw;

  const handlingRaw = formatHandlingAssessmentForEngineer(lastRun.handlingAssessmentJson).trim();
  const handlingPreview =
    !handlingRaw ? "" : handlingRaw.length > 400 ? `${handlingRaw.slice(0, 397)}…` : handlingRaw;

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
      notesPreview,
      handlingPreview,
    },
    thingsToTry,
    thingsToDo,
  };
}
