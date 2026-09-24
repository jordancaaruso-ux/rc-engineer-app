import "server-only";
import { prisma } from "@/lib/prisma";
import { getEntitlementFor } from "@/lib/entitlement";
import { teamJoinVerdict, teamLimitFor, type PaidTier } from "@/lib/entitlementLogic";
import { TIER_LABELS } from "@/lib/brand/brandNames";

/**
 * The team limit (`teamLimitFor`, founder call 2026-09-24) as the Teams page and the two routes that
 * make a membership meet it: starting a team (`POST /api/teams`) and accepting an invite
 * (`POST /api/teams/invites/[inviteId]`). Null = the member may start or join one more; otherwise the
 * plan the lock sells.
 *
 * Race Engineer, grandfathered accounts and dark enforcement have no limit, so they skip the count.
 * The page already holds the member's teams and passes `teamCount`; the routes let this count.
 */
export async function teamJoinLock(
  user: { id: string; email: string | null },
  teamCount?: number,
): Promise<{ includedIn: PaidTier } | null> {
  const { tier } = await getEntitlementFor(user.id, user.email);
  if (teamLimitFor(tier) == null) return null;
  const count = teamCount ?? (await prisma.teamMembership.count({ where: { userId: user.id } }));
  const verdict = teamJoinVerdict(tier, count);
  return verdict.ok ? null : { includedIn: verdict.includedIn };
}

/** What a refused start or accept says (402). The page shows the lock before anyone gets here. */
export function teamLockMessage(includedIn: PaidTier): string {
  return includedIn === "pro"
    ? `More than one team is part of ${TIER_LABELS.pro}. Upgrade on the Subscription page to join another.`
    : `Teams are part of ${TIER_LABELS[includedIn]}. Upgrade on the Subscription page to start or join one.`;
}
