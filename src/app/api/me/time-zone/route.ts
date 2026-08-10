import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { sanitizeIanaTimeZone } from "@/lib/rcTimeZoneCookie";

/**
 * Persist the signed-in account's IANA zone from the device that is looking.
 *
 * `User.timeZone` is what decides which calendar day another driver's runs
 * belong to when the runs themselves predate per-run zone capture
 * (`resolveRunLocalTimeZone`: run → owner → viewer). Until now the ONLY thing
 * that ever wrote it was creating a run — so a driver who had not logged one
 * since 2026-08-09 still had a null zone, every one of their historical runs
 * fell through to the *reader's* zone, and a continuous test day went on
 * splitting across two dates exactly as it did before the fix. Shipping the
 * column did nothing on its own; this is the write path that fills it.
 *
 * Because the owner fallback is per-user rather than per-run, one successful
 * call here repairs that driver's whole history at once — they only have to
 * open the app.
 *
 * The zone is read from the POST body rather than the `rc_tz` cookie: the
 * cookie is written by the same client effect that calls this, and reading it
 * server-side would race a first visit where the cookie is set in the same tick.
 */
export async function POST(req: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { timeZone?: unknown } | null;
  const timeZone = sanitizeIanaTimeZone(
    typeof body?.timeZone === "string" ? body.timeZone : null
  );
  if (!timeZone) return NextResponse.json({ error: "Invalid time zone" }, { status: 400 });

  // The inequality means a returning device costs one cheap no-op query rather
  // than a write on every visit — the same guard the run-create path uses.
  const { count } = await prisma.user.updateMany({
    where: { id: userId, OR: [{ timeZone: null }, { timeZone: { not: timeZone } }] },
    data: { timeZone },
  });

  return NextResponse.json({ ok: true, changed: count > 0 });
}
