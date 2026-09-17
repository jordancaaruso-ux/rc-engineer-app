import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { listPendingInvitesForUser } from "@/lib/teams/pendingInvites";

export const dynamic = "force-dynamic";

/**
 * The caller's own pending team invites, for the dashboard card.
 *
 * Scoped to `invitedUserId = caller` — this is the invitee's inbox, not an admin view. Admins see
 * outstanding invites for their team on `GET /api/teams/[teamId]` instead. The `/teams` page reads
 * the same loader server-side, so the card and the page always agree on what is waiting.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ invites: await listPendingInvitesForUser(userId) });
}
