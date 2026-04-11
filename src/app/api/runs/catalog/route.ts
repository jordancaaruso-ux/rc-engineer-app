import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { buildRunCatalogV1 } from "@/lib/engineerPhase5/runCatalog";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const catalog = await buildRunCatalogV1({ userId: user.id });
  return NextResponse.json({ catalog });
}
