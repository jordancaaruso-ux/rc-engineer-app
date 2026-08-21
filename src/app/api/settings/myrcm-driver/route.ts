import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { getMyRcmDriverNameSetting, setMyRcmDriverNameSetting } from "@/lib/appSettings";

/**
 * Name on MyRCM.
 *
 * MyRCM publishes no driver id and no transponder on its public results, so the printed name is the
 * only handle on which row of the field belongs to this driver. Optional: the import falls back to
 * the MYLAPS and LiveRC names before giving up, and when nothing matches it imports the field and
 * asks rather than handing back the winner's laps.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const myRcmDriverName = await getMyRcmDriverNameSetting(userId);
  return NextResponse.json({ myRcmDriverName });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    myRcmDriverName?: string | null;
  } | null;

  if (typeof body?.myRcmDriverName === "string" || body?.myRcmDriverName === null) {
    const trimmed = typeof body.myRcmDriverName === "string" ? body.myRcmDriverName.trim() : null;
    await setMyRcmDriverNameSetting(userId, trimmed || null);
  }

  const myRcmDriverName = await getMyRcmDriverNameSetting(userId);
  return NextResponse.json({ myRcmDriverName });
}
