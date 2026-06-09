import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasDatabaseUrl } from "@/lib/env";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { loadTimingSessionFromUrl } from "@/lib/manualVideoAnalysis/loadTiming";
import { defaultDriverKeys } from "@/lib/manualVideoAnalysis/timing";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    url?: string;
    urls?: string[];
    primaryDriverName?: string | null;
  } | null;

  const urlList = [
    ...(Array.isArray(body?.urls) ? body.urls : []),
    ...(body?.url?.trim() ? [body.url.trim()] : []),
  ]
    .map((u) => u.trim())
    .filter(Boolean);

  if (urlList.length === 0) {
    return NextResponse.json({ error: "url or urls required" }, { status: 400 });
  }

  const primaryDriverName =
    body?.primaryDriverName?.trim() ||
    (await getLiveRcDriverNameSetting(user.id)) ||
    null;

  const allowAnyPublicHost = isAuthAdminEmail(user.email);
  const sessions = [];
  const errors: string[] = [];

  for (const url of urlList) {
    const result = await loadTimingSessionFromUrl(url, primaryDriverName, {
      allowAnyPublicHost,
    });
    if ("error" in result) {
      errors.push(`${url}: ${result.error}`);
      continue;
    }
    sessions.push(result.session);
  }

  if (sessions.length === 0) {
    return NextResponse.json(
      { error: errors.join("; ") || "No sessions parsed" },
      { status: 400 }
    );
  }

  const allDrivers = sessions.flatMap((s) => s.drivers);

  return NextResponse.json({
    sessions,
    drivers: allDrivers,
    parserId: "batch",
    defaults: defaultDriverKeys(allDrivers),
    primaryDriverName,
    errors: errors.length > 0 ? errors : undefined,
  });
}
