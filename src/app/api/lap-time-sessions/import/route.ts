import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { importOneTimingUrl } from "@/lib/lapImport/service";

/**
 * Batch import timing URLs: each URL uses parseTimingUrl + persisted ImportedLapTimeSession.
 * Failures are per-URL; successful imports are still saved.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { urls?: unknown; url?: unknown }
    | null;

  const rawList: string[] = [];
  if (Array.isArray(body?.urls)) {
    for (const u of body.urls) {
      if (typeof u === "string" && u.trim()) rawList.push(u.trim());
    }
  } else if (typeof body?.url === "string" && body.url.trim()) {
    rawList.push(body.url.trim());
  }

  if (rawList.length === 0) {
    return NextResponse.json({ error: "Provide url or urls[]" }, { status: 400 });
  }

  const results = [];
  for (const url of rawList) {
    const r = await importOneTimingUrl(user.id, url);
    results.push(r);
  }

  revalidatePath("/laps/import");

  return NextResponse.json({ results });
}
