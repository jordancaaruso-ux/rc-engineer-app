import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { parseTimingUrl } from "@/lib/lapUrlParsers/registry";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  await getOrCreateLocalUser();

  const body = (await request.json().catch(() => null)) as { url?: string; driverName?: string } | null;
  const url = body?.url?.trim() ?? "";
  const driverName = typeof body?.driverName === "string" ? body.driverName.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return NextResponse.json({ error: "URL must be http(s)" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const parsed = await parseTimingUrl(url, { driverName: driverName || undefined });

  return NextResponse.json({
    parserId: parsed.parserId,
    laps: parsed.laps,
    lapRows: parsed.lapRows ?? null,
    candidates: parsed.candidates ?? [],
    sessionHint: parsed.sessionHint ?? null,
    message: parsed.message ?? null,
    errorCode: parsed.errorCode ?? null,
    url,
  });
}
