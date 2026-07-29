import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getLastRunForCopyPreview } from "@/lib/runs/getLastRunForCopyPreview";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lastRun = await getLastRunForCopyPreview(userId);

  return NextResponse.json({ lastRun });
}
