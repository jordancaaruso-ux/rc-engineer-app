import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  getSpeedhiveDriverNameForUser,
  getSpeedhiveDriverNameSetting,
  setSpeedhiveDriverNameSetting,
} from "@/lib/appSettings";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [speedhiveDriverName, effectiveDriverName] = await Promise.all([
    getSpeedhiveDriverNameSetting(user.id),
    getSpeedhiveDriverNameForUser(user.id),
  ]);
  return NextResponse.json({ speedhiveDriverName, effectiveDriverName });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    speedhiveDriverName?: string | null;
  } | null;

  if (typeof body?.speedhiveDriverName === "string" || body?.speedhiveDriverName === null) {
    await setSpeedhiveDriverNameSetting(user.id, body.speedhiveDriverName);
  }

  const [speedhiveDriverName, effectiveDriverName] = await Promise.all([
    getSpeedhiveDriverNameSetting(user.id),
    getSpeedhiveDriverNameForUser(user.id),
  ]);
  return NextResponse.json({ speedhiveDriverName, effectiveDriverName });
}
