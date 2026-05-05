import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  getLiveRcDriverIdSetting,
  getLiveRcDriverNameSetting,
  setLiveRcDriverIdSetting,
  setLiveRcDriverNameSetting,
} from "@/lib/appSettings";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [liveRcDriverName, liveRcDriverId] = await Promise.all([
    getLiveRcDriverNameSetting(user.id),
    getLiveRcDriverIdSetting(user.id),
  ]);
  return NextResponse.json({ liveRcDriverName, liveRcDriverId });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    liveRcDriverName?: string | null;
    liveRcDriverId?: string | null;
  } | null;

  if (typeof body?.liveRcDriverName === "string" || body?.liveRcDriverName === null) {
    await setLiveRcDriverNameSetting(user.id, body.liveRcDriverName);
  }
  if (typeof body?.liveRcDriverId === "string" || body?.liveRcDriverId === null) {
    await setLiveRcDriverIdSetting(user.id, body.liveRcDriverId);
  }

  const [liveRcDriverName, liveRcDriverId] = await Promise.all([
    getLiveRcDriverNameSetting(user.id),
    getLiveRcDriverIdSetting(user.id),
  ]);
  return NextResponse.json({ liveRcDriverName, liveRcDriverId });
}
