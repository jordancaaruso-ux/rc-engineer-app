import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getMylapsConnection } from "@/lib/mylaps/mylapsConnection";
import { mylapsOAuthConfiguredForApp } from "@/lib/mylaps/mylapsAuthConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getMylapsConnection(user.id);
  return NextResponse.json({
    connected: Boolean(conn),
    accountId: conn?.accountId ?? null,
    chipCount: conn?.chipNumbers.length ?? 0,
    chipNumbers: conn?.chipNumbers ?? [],
    oauthAppConfigured: mylapsOAuthConfiguredForApp(),
  });
}
