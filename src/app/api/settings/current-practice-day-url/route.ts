import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  getCurrentPracticeDayUrlSetting,
  setCurrentPracticeDayUrlSetting,
} from "@/lib/appSettings";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const currentPracticeDayUrl = await getCurrentPracticeDayUrlSetting(user.id);
  return NextResponse.json({ currentPracticeDayUrl });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { currentPracticeDayUrl?: string | null } | null;
  await setCurrentPracticeDayUrlSetting(
    user.id,
    typeof body?.currentPracticeDayUrl === "string" ? body.currentPracticeDayUrl : null
  );
  const currentPracticeDayUrl = await getCurrentPracticeDayUrlSetting(user.id);
  return NextResponse.json({ currentPracticeDayUrl });
}
