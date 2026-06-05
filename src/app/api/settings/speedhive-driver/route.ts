import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  getSpeedhiveDriverNameForUser,
  getSpeedhiveDriverNameSetting,
  getSpeedhiveTransponderNumbersSetting,
  setSpeedhiveDriverNameSetting,
  setSpeedhiveTransponderNumbersSetting,
} from "@/lib/appSettings";
import {
  formatSpeedhiveTransponderNumbersForSetting,
  parseSpeedhiveTransponderNumbersSetting,
} from "@/lib/speedhive/speedhiveTransponder";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [speedhiveDriverName, effectiveDriverName, transponderRaw] = await Promise.all([
    getSpeedhiveDriverNameSetting(user.id),
    getSpeedhiveDriverNameForUser(user.id),
    getSpeedhiveTransponderNumbersSetting(user.id),
  ]);
  const transponderNumbers = parseSpeedhiveTransponderNumbersSetting(transponderRaw);
  return NextResponse.json({
    speedhiveDriverName,
    effectiveDriverName,
    speedhiveTransponderNumbers: transponderNumbers,
    speedhiveTransponderNumbersText: formatSpeedhiveTransponderNumbersForSetting(transponderNumbers),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    speedhiveDriverName?: string | null;
    speedhiveTransponderNumbers?: string | null;
  } | null;

  if (typeof body?.speedhiveDriverName === "string" || body?.speedhiveDriverName === null) {
    await setSpeedhiveDriverNameSetting(user.id, body.speedhiveDriverName);
  }

  if (
    typeof body?.speedhiveTransponderNumbers === "string" ||
    body?.speedhiveTransponderNumbers === null
  ) {
    const parsed = parseSpeedhiveTransponderNumbersSetting(body.speedhiveTransponderNumbers);
    await setSpeedhiveTransponderNumbersSetting(
      user.id,
      parsed.length > 0 ? formatSpeedhiveTransponderNumbersForSetting(parsed) : null
    );
  }

  const [speedhiveDriverName, effectiveDriverName, transponderRaw] = await Promise.all([
    getSpeedhiveDriverNameSetting(user.id),
    getSpeedhiveDriverNameForUser(user.id),
    getSpeedhiveTransponderNumbersSetting(user.id),
  ]);
  const transponderNumbers = parseSpeedhiveTransponderNumbersSetting(transponderRaw);
  return NextResponse.json({
    speedhiveDriverName,
    effectiveDriverName,
    speedhiveTransponderNumbers: transponderNumbers,
    speedhiveTransponderNumbersText: formatSpeedhiveTransponderNumbersForSetting(transponderNumbers),
  });
}
