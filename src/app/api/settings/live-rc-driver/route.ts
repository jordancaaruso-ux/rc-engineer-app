import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { getLiveRcDriverNameSetting, setLiveRcDriverNameSetting } from "@/lib/appSettings";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const liveRcDriverName = await getLiveRcDriverNameSetting(user.id);
  return NextResponse.json({ liveRcDriverName });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => null)) as { liveRcDriverName?: string | null } | null;
  await setLiveRcDriverNameSetting(user.id, typeof body?.liveRcDriverName === "string" ? body.liveRcDriverName : null);
  const liveRcDriverName = await getLiveRcDriverNameSetting(user.id);
  return NextResponse.json({ liveRcDriverName });
}

