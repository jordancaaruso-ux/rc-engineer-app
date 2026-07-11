import { NextResponse } from "next/server";

import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { importOneTimingUrl } from "@/lib/lapImport/service";

export const dynamic = "force-dynamic";

/**
 * Flagship Stage 3 — the "tap" target for a new-result notification.
 * Imports the timing session (idempotent by sourceUrl; NEVER done automatically —
 * only on this user-initiated tap) then redirects into the existing Add Run flow
 * (`?importedLapTimeSessionId=`), which offers "link to a draft" or "new run".
 *
 * A plain GET so a notification / link opens it directly; also handy for testing
 * without a push: visit /api/laps/import-and-log?session=<encoded session url>.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionUrl = url.searchParams.get("session")?.trim() ?? "";

  const user = await getAuthenticatedApiUser();
  if (!user) {
    const to = new URL("/login", req.url);
    to.searchParams.set("from", `/api/laps/import-and-log?session=${encodeURIComponent(sessionUrl)}`);
    return NextResponse.redirect(to);
  }

  if (!sessionUrl) {
    return NextResponse.redirect(new URL("/runs/new", req.url));
  }

  const imported = await importOneTimingUrl(user.id, sessionUrl);
  if (imported.success && imported.importedSessionId) {
    const to = new URL("/runs/new", req.url);
    to.searchParams.set("importedLapTimeSessionId", imported.importedSessionId);
    return NextResponse.redirect(to);
  }

  // Import failed (e.g. result not posted yet) — still take them to Add Run so they
  // can log manually; flag it so the form can surface a gentle note if desired.
  const to = new URL("/runs/new", req.url);
  to.searchParams.set("importError", "1");
  return NextResponse.redirect(to);
}
