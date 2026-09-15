/**
 * Which open run takes which timing session — "the timing site opens the run, the driver
 * closes it" (founder rulings 2026-09-14).
 *
 * A claimant is a run the driver opened themselves that has no laps yet: a draft ("I'm about to
 * go out"), or a logged run saved without laps. Its anchor is when it was opened. Claimants take
 * sessions FORWARD in time: oldest claimant first, each takes the first unclaimed session that
 * started after its anchor, one session per claimant. Whatever is left over is unclaimed and
 * becomes a placeholder (or a loose import) in the caller.
 *
 * The caller passes only the same track-local day: a draft opened yesterday must not grab
 * today's first run. Pure so the rule is unit-tested.
 */

export type DraftClaimant = {
  id: string;
  /** When the driver opened it — a draft's `createdAt`, a lap-less logged run's `sortAt`. */
  anchor: Date;
};

export type ClaimableSession = {
  id: string;
  /** When the car was on track (a real instant). */
  instant: Date;
};

export type DraftClaim = { claimantId: string; sessionId: string };

export type DraftClaimPlan = {
  claims: DraftClaim[];
  unclaimedSessionIds: string[];
};

export function planDraftClaims(input: {
  claimants: readonly DraftClaimant[];
  sessions: readonly ClaimableSession[];
}): DraftClaimPlan {
  const claimants = [...input.claimants].sort((a, b) => a.anchor.getTime() - b.anchor.getTime());
  const sessions = [...input.sessions].sort((a, b) => a.instant.getTime() - b.instant.getTime());
  const taken = new Set<string>();
  const claims: DraftClaim[] = [];

  for (const claimant of claimants) {
    const anchorT = claimant.anchor.getTime();
    const session = sessions.find((s) => !taken.has(s.id) && s.instant.getTime() > anchorT);
    if (!session) continue;
    taken.add(session.id);
    claims.push({ claimantId: claimant.id, sessionId: session.id });
  }

  return {
    claims,
    unclaimedSessionIds: sessions.filter((s) => !taken.has(s.id)).map((s) => s.id),
  };
}
