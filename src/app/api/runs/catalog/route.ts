import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { buildRunCatalogV1 } from "@/lib/engineerPhase5/runCatalog";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const catalog = await buildRunCatalogV1({ userId: user.id });
  return NextResponse.json({ catalog });
}
