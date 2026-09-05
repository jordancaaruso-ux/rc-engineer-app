import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public liveness check for an uptime pinger — the one route that answers without a session.
 *
 * `src/middleware.ts` already lets `/api/health/*` through; until 2026-09-05 the only route under
 * it (`openai`) still demanded a signed-in user, so nothing outside the app could tell whether
 * production was up. This one runs a single `SELECT 1` against the database and says yes or no.
 * It exposes nothing: no host, no counts, no version — a 200 means "the app can reach its
 * database", a 503 means it cannot, and the body is the same three fields either way.
 *
 * Point a free uptime monitor at it (see MONETISATION_NORTH_STAR.md, "Watch week one").
 */
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5_000;

export async function GET(): Promise<Response> {
  const started = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("database timed out")), TIMEOUT_MS),
      ),
    ]);
    return NextResponse.json(
      { ok: true, db: "up", ms: Date.now() - started },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, db: "down", ms: Date.now() - started },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
