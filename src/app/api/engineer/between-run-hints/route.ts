import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  findLatestPrimaryRunIdForHints,
  getOrComputeBetweenRunHint,
  peekBetweenRunHint,
} from "@/lib/engineerPhase5/betweenRunHints/getOrComputeBetweenRunHints";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim() || null;
  const sync =
    url.searchParams.get("sync") === "1" || url.searchParams.get("sync")?.toLowerCase() === "true";

  let primaryId = runId;
  if (!primaryId) {
    primaryId = await findLatestPrimaryRunIdForHints(user.id);
  }
  if (!primaryId) {
    return NextResponse.json({ hint: null });
  }

  if (sync) {
    const { hint } = await getOrComputeBetweenRunHint(user.id, primaryId);
    return NextResponse.json({ hint });
  }

  const peeked = await peekBetweenRunHint(user.id, primaryId);
  if (!peeked) {
    void getOrComputeBetweenRunHint(user.id, primaryId).catch(() => {});
  }
  return NextResponse.json({ hint: peeked });
}
