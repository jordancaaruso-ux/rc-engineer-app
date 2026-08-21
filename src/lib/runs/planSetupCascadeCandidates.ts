import "server-only";

import { prisma } from "@/lib/prisma";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import { planSetupCorrection } from "@/lib/runs/setupCorrectionCascade";

/**
 * The runs either side of a correction that plausibly share one wrong setup value,
 * described well enough for a driver to tick them.
 *
 * ============================== WHY IT IS SHARED ==============================
 *
 * `PATCH /api/runs/[id]/setup-snapshot` — the setup SHEET — is where a driver corrects a
 * setup (founder call, 2026-08-20: "editing a setup always through the pdf"), and it is
 * the live caller.
 *
 * `POST /api/runs/[id]/setup-correction` also calls this. It served the inline text box on
 * the run page, which went the same day the sheet became the only editor, so **it has no
 * client caller left** — only its `./apply` child does, which is what writes the ticked
 * runs. Worth knowing before reading it as a second live path; worth deleting when someone
 * has established nothing outside `src/` reaches for it.
 *
 * Sharing the planner is what stopped the better door from silently costing the feature
 * when it arrived.
 *
 * The rule itself — walk out, stop at the first run holding a genuine third value, treat a
 * run already holding the corrected value as transparent — lives in `setupCorrectionCascade`
 * and is deliberately not restated here.
 *
 * ============================== THE TWO SIDES ARE NOT SYMMETRICAL ==============================
 *
 * Both directions are walked (founder call, 2026-08-21 — forward-only meant correcting the
 * newest run on a car could never offer anything). What differs is what comes back:
 *
 *  - **Later runs**: every one is returned, and the walk decides which arrive ticked. The
 *    full list is deliberate — a driver who hand-fixed a run weeks ago, beyond a deliberate
 *    change, is exactly the case a truncated list would hide.
 *  - **Earlier runs**: returned only as far as the walk reaches, plus the run that stopped
 *    it, and never ticked. Truncated because "everything before this" is the car's whole
 *    history rather than a handful of rows, and the stopping run is included so the list
 *    explains why it ends instead of just ending.
 */
export type SetupCascadeCandidate = {
  runId: string;
  defaultPicked: boolean;
  occurredAtIso: string;
  sessionLabel: string;
  eventName: string | null;
  /** Which way this run sits from the one that was corrected. */
  side: "earlier" | "later";
  /** This run holds a value the driver typed on purpose — shown, never offered. */
  stopsWalk: boolean;
  /** For the picker's "says …" column. */
  displayValue: string;
  holdsOldValue: boolean;
  alreadyCorrect: boolean;
};

const NEIGHBOUR_SELECT = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  sortAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  event: { select: { name: true } },
  trackNameSnapshot: true,
  track: { select: { name: true } },
  setupSnapshot: { select: { data: true } },
} as const;

/**
 * How many runs before the corrected one are read at all.
 *
 * The walk almost always stops within a handful, but a car whose sheet has genuinely never
 * changed for that field has no stop — so without a bound this reads the driver's entire
 * history for one question. Generous enough that the cap is never what ends a real walk.
 */
const EARLIER_SCAN_LIMIT = 60;

export async function planCascadeCandidatesForRun(params: {
  userId: string;
  run: { id: string; carId: string; sortAt: Date };
  key: string;
  previousValue: unknown;
  /** The corrected value as the planner reads it — a trimmed scalar, "" for cleared. */
  nextValue: string;
}): Promise<SetupCascadeCandidate[]> {
  /*
   * `sortAt` is the stable "logged after" axis — stamped once at create, so a re-imported
   * timing session can never reshuffle a day and move a run to the wrong side of the
   * correction.
   *
   * Earlier runs come back NEWEST first, which is the order the walk needs (nearest to the
   * correction first) and also what makes the scan limit take the nearest 60 rather than the
   * oldest 60.
   */
  const [laterRuns, earlierRunsNearestFirst] = await Promise.all([
    prisma.run.findMany({
      where: { userId: params.userId, carId: params.run.carId, sortAt: { gt: params.run.sortAt } },
      select: NEIGHBOUR_SELECT,
      orderBy: { sortAt: "asc" },
    }),
    prisma.run.findMany({
      where: { userId: params.userId, carId: params.run.carId, sortAt: { lt: params.run.sortAt } },
      select: NEIGHBOUR_SELECT,
      orderBy: { sortAt: "desc" },
      take: EARLIER_SCAN_LIMIT,
    }),
  ]);

  const valueOf = (r: { setupSnapshot: { data: unknown } | null }) =>
    normalizeSetupSnapshotForStorage(r.setupSnapshot?.data ?? null)[params.key];

  const plannedLater = planSetupCorrection({
    key: params.key,
    previousValue: params.previousValue,
    nextValue: params.nextValue,
    runs: laterRuns.map((r) => ({ id: r.id, value: valueOf(r) })),
  });

  const plannedEarlier = planSetupCorrection({
    key: params.key,
    previousValue: params.previousValue,
    nextValue: params.nextValue,
    runs: earlierRunsNearestFirst.map((r) => ({ id: r.id, value: valueOf(r) })),
    // Never ticked — the walk backwards is a guess at intent, not read inheritance.
    tickReached: false,
  });

  /*
   * Cut the earlier side at its stop. Everything past the run that ended the walk descends
   * from a value typed on purpose and has nothing to do with this mistake; the stopping run
   * itself is kept so the list says why it ends.
   */
  const stopIndex = plannedEarlier.findIndex((c) => c.stopsWalk);
  const earlierKept = stopIndex >= 0 ? plannedEarlier.slice(0, stopIndex + 1) : plannedEarlier;

  const byId = new Map(
    [...laterRuns, ...earlierRunsNearestFirst].map((r) => [r.id, r] as const)
  );

  const describe = (
    c: (typeof plannedLater)[number],
    side: "earlier" | "later"
  ): SetupCascadeCandidate => {
    const r = byId.get(c.runId)!;
    return {
      runId: c.runId,
      defaultPicked: c.defaultPicked,
      displayValue: c.displayValue,
      holdsOldValue: c.holdsOldValue,
      alreadyCorrect: c.alreadyCorrect,
      stopsWalk: c.stopsWalk,
      side,
      occurredAtIso: resolveRunDisplayInstant(r).toISOString(),
      sessionLabel: formatRunSessionDisplay(r, { fallback: "Testing run" }),
      eventName: r.event?.name ?? r.track?.name ?? r.trackNameSnapshot ?? null,
    };
  };

  /*
   * Oldest first overall, so the sheet reads down the way a day does: the earlier side is
   * reversed back out of walk order into logged order before the later side is appended.
   */
  return [
    ...earlierKept.map((c) => describe(c, "earlier")).reverse(),
    ...plannedLater.map((c) => describe(c, "later")),
  ];
}
