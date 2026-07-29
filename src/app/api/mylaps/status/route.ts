import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { getMylapsConnection } from "@/lib/mylaps/mylapsConnection";
import { mylapsOAuthConfiguredForApp } from "@/lib/mylaps/mylapsAuthConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getMylapsConnection(userId);
  return NextResponse.json({
    connected: Boolean(conn),
    accountId: conn?.accountId ?? null,
    chipCount: conn?.chipNumbers.length ?? 0,
    chipNumbers: conn?.chipNumbers ?? [],
    oauthAppConfigured: mylapsOAuthConfiguredForApp(),
  });
}
