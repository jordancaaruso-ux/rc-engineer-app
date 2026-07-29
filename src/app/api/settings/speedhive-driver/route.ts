import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import {
  getSpeedhiveDriverNameForUser,
  getSpeedhiveDriverNameSetting,
  getSpeedhiveTransponderLoanerSetting,
  getSpeedhiveTransponderNumbersSetting,
  setSpeedhiveDriverNameSetting,
  setSpeedhiveTransponderLoanerSetting,
  setSpeedhiveTransponderNumbersSetting,
} from "@/lib/appSettings";
import {
  formatSpeedhiveTransponderNumbersForSetting,
  parseSpeedhiveTransponderNumbersSetting,
} from "@/lib/speedhive/speedhiveTransponder";

async function readIdentity(userId: string) {
  const [speedhiveDriverName, effectiveDriverName, transponderRaw, transponderLoaner] =
    await Promise.all([
      getSpeedhiveDriverNameSetting(userId),
      getSpeedhiveDriverNameForUser(userId),
      getSpeedhiveTransponderNumbersSetting(userId),
      getSpeedhiveTransponderLoanerSetting(userId),
    ]);
  const transponderNumbers = parseSpeedhiveTransponderNumbersSetting(transponderRaw);
  return {
    speedhiveDriverName,
    effectiveDriverName,
    speedhiveTransponderNumbers: transponderNumbers,
    speedhiveTransponderNumbersText: formatSpeedhiveTransponderNumbersForSetting(transponderNumbers),
    speedhiveTransponderLoaner: transponderLoaner,
  };
}

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await readIdentity(userId));
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    speedhiveDriverName?: string | null;
    speedhiveTransponderNumbers?: string | null;
    speedhiveTransponderLoaner?: boolean;
  } | null;

  if (typeof body?.speedhiveDriverName === "string" || body?.speedhiveDriverName === null) {
    await setSpeedhiveDriverNameSetting(userId, body.speedhiveDriverName);
  }

  if (typeof body?.speedhiveTransponderLoaner === "boolean") {
    await setSpeedhiveTransponderLoanerSetting(userId, body.speedhiveTransponderLoaner);
  }

  if (
    typeof body?.speedhiveTransponderNumbers === "string" ||
    body?.speedhiveTransponderNumbers === null
  ) {
    const parsed = parseSpeedhiveTransponderNumbersSetting(body.speedhiveTransponderNumbers);
    await setSpeedhiveTransponderNumbersSetting(
      userId,
      parsed.length > 0 ? formatSpeedhiveTransponderNumbersForSetting(parsed) : null
    );
    // A real number supersedes "I'm on a club chip" — otherwise the flag would
    // sit there forever telling onboarding not to ask again.
    if (parsed.length > 0) await setSpeedhiveTransponderLoanerSetting(userId, false);
  }

  return NextResponse.json(await readIdentity(userId));
}
