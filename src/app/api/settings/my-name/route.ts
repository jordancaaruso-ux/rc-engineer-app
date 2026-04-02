import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { getMyNameSetting, setMyNameSetting } from "@/lib/appSettings";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const myName = await getMyNameSetting(user.id);
  return NextResponse.json({ myName });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => null)) as { myName?: string | null } | null;
  await setMyNameSetting(user.id, typeof body?.myName === "string" ? body.myName : null);
  const myName = await getMyNameSetting(user.id);
  return NextResponse.json({ myName });
}
