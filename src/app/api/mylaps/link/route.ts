import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { saveMylapsConnection } from "@/lib/mylaps/mylapsConnection";
import {
  accountIdFromMylapsClaims,
  fetchMylapsChipNumbers,
  fetchMylapsClaims,
  normalizeMylapsAccessToken,
  validateMylapsAccessToken,
} from "@/lib/mylaps/mylapsUsersApi";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { accessToken?: string } | null;
  const raw = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  if (!raw) {
    return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
  }

  const accessToken = normalizeMylapsAccessToken(raw);
  const valid = await validateMylapsAccessToken(accessToken);
  if (!valid) {
    return NextResponse.json(
      { error: "That access token is not valid or has expired. Sign in to Speedhive again and paste a fresh token." },
      { status: 400 }
    );
  }

  let claims: Record<string, unknown>;
  try {
    claims = await fetchMylapsClaims(accessToken);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not read account info from MYLAPS.",
      },
      { status: 400 }
    );
  }

  const accountId = accountIdFromMylapsClaims(claims, accessToken);
  if (!accountId) {
    return NextResponse.json(
      { error: "Could not determine your MYLAPS account id from this token." },
      { status: 400 }
    );
  }

  let chipNumbers: number[] = [];
  try {
    chipNumbers = await fetchMylapsChipNumbers(accountId, accessToken);
  } catch {
    chipNumbers = [];
  }

  await saveMylapsConnection(user.id, {
    accountId,
    accessToken,
    chipNumbers,
  });

  return NextResponse.json({
    ok: true,
    connected: true,
    accountId,
    chipCount: chipNumbers.length,
    chipNumbers,
  });
}
