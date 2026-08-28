import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { getKnownCompetitorsSetting, setKnownCompetitorsSetting } from "@/lib/appSettings";
import {
  parseKnownCompetitorsSetting,
  serializeKnownCompetitorsSetting,
  type KnownCompetitor,
} from "@/lib/speedhive/knownCompetitors";

/**
 * The transponder numbers you know of other drivers.
 *
 * Whole-list writes, not per-row: the list is short and the Settings block edits it as a
 * unit, so a partial update would only add a merge to get wrong. Everything is normalised
 * through the same parser the reader uses, so what comes back is exactly what was stored.
 */

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    competitors: parseKnownCompetitorsSetting(await getKnownCompetitorsSetting(userId)),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    /** JSON string, so this rides the same `postSetting` helper every other Settings row uses. */
    knownCompetitors?: string | null;
  } | null;

  if (typeof body?.knownCompetitors !== "string" && body?.knownCompetitors !== null) {
    return NextResponse.json({ error: "knownCompetitors is required" }, { status: 400 });
  }

  const parsed: KnownCompetitor[] = parseKnownCompetitorsSetting(body.knownCompetitors);
  await setKnownCompetitorsSetting(
    userId,
    parsed.length > 0 ? serializeKnownCompetitorsSetting(parsed) : null
  );
  return NextResponse.json({ competitors: parsed });
}
