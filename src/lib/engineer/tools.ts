import "server-only";

import { prisma } from "@/lib/prisma";
import type { EngineerRangeScope } from "@/lib/engineer/rangeScope";
import { loadLiveRcPracticeField } from "@/lib/practiceField/loadPracticeField";
import {
  LIVERC_PRACTICE_TOOL_DEFINITION,
  LIVERC_PRACTICE_TOOL_NAME,
  parsePracticeDayArg,
  renderLivercPracticeDay,
} from "@/lib/engineer/livercPracticeTool";

import { MAX_TOOL_CALLS_PER_ANSWER, type EngineerTools } from "@/lib/engineer/toolTypes";

/**
 * What the Engineer may call this turn, and how the call is run. One tool so far
 * (livercPracticeTool.ts). The route builds the context from the subject — the run being
 * looked at, or the range's track — and offers the tool only when that track has a LiveRC
 * page: a tool that can only answer "no page" would cost a round trip for nothing.
 *
 * The run itself is bounded: a few calls per answer, a day at a time, and every call goes
 * through the same LiveRC reader the lap sheet's Practice tab uses.
 */

export type EngineerToolContext = {
  userId: string;
  track: { name: string; liveRcUrl: string };
  /** The class the driver logged for the subject run; null when unknown. */
  myClass: string | null;
};

async function trackWithLiveRc(trackId: string | null | undefined) {
  if (!trackId) return null;
  const t = await prisma.track.findUnique({ where: { id: trackId }, select: { name: true, liveRcUrl: true } }).catch(() => null);
  return t?.liveRcUrl?.trim() ? { name: t.name, liveRcUrl: t.liveRcUrl.trim() } : null;
}

/**
 * The context for this turn's subject: the pinned or latest run's track, or the range's.
 * Null when there is no subject, or its track has no LiveRC page — then no tool is offered.
 */
export async function loadEngineerToolContext(params: {
  userId: string;
  runId: string | null;
  scope: EngineerRangeScope | null;
}): Promise<EngineerToolContext | null> {
  if (params.scope) {
    const track = await trackWithLiveRc(params.scope.trackId);
    return track ? { userId: params.userId, track, myClass: null } : null;
  }
  const run = await prisma.run
    .findFirst({
      where: params.runId ? { id: params.runId, userId: params.userId } : { userId: params.userId },
      orderBy: params.runId ? undefined : { sortAt: "desc" },
      select: { trackId: true, raceClass: true },
    })
    .catch(() => null);
  if (!run) return null;
  const track = await trackWithLiveRc(run.trackId);
  if (!track) return null;
  return { userId: params.userId, track, myClass: run.raceClass };
}

export function engineerTools(ctx: EngineerToolContext): EngineerTools {
  let calls = 0;
  return {
    definitions: [LIVERC_PRACTICE_TOOL_DEFINITION],
    run: async (name, argumentsJson) => {
      calls++;
      if (calls > MAX_TOOL_CALLS_PER_ANSWER) {
        return "No more reads this answer: answer with what is already in DRIVER DATA and what has been read.";
      }
      if (name !== LIVERC_PRACTICE_TOOL_NAME) return `There is no tool called "${name}".`;
      const day = parsePracticeDayArg(argumentsJson);
      if (!day) return "The day must be given as YYYY-MM-DD.";
      try {
        const result = await loadLiveRcPracticeField({
          userId: ctx.userId,
          trackLiveRcUrl: ctx.track.liveRcUrl,
          dayYmd: day,
        });
        if (result.hint && result.drivers.length === 0) {
          return `DRIVER DATA — LIVERC PRACTICE at ${ctx.track.name}, ${day}: ${result.hint}`;
        }
        return renderLivercPracticeDay({
          trackName: ctx.track.name,
          dayYmd: day,
          drivers: result.drivers,
          myClass: ctx.myClass,
        });
      } catch {
        return `DRIVER DATA — LIVERC PRACTICE at ${ctx.track.name}, ${day}: Couldn't reach LiveRC just now.`;
      }
    },
  };
}
