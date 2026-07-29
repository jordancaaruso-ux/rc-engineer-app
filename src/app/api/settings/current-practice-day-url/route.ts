import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import {
  getCurrentPracticeDayUrlSetting,
  setCurrentPracticeDayUrlSetting,
} from "@/lib/appSettings";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const currentPracticeDayUrl = await getCurrentPracticeDayUrlSetting(userId);
  return NextResponse.json({ currentPracticeDayUrl });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { currentPracticeDayUrl?: string | null } | null;
  await setCurrentPracticeDayUrlSetting(
    userId,
    typeof body?.currentPracticeDayUrl === "string" ? body.currentPracticeDayUrl : null
  );
  const currentPracticeDayUrl = await getCurrentPracticeDayUrlSetting(userId);
  return NextResponse.json({ currentPracticeDayUrl });
}
