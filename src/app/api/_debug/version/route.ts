import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Which build is actually serving this request?
 *
 * Deliberately unauthenticated: the question it answers usually comes up *because* auth sent you
 * somewhere unexpected (an `AUTH_URL` pinned to production bounces a preview login back to prod,
 * so you end up testing the old build while believing you are on the new one). Requiring a session
 * to find that out would make it useless. Emits only build identity — no config, no secrets.
 */
export async function GET() {
  return NextResponse.json({
    env: process.env.VERCEL_ENV ?? "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
    deploymentUrl: process.env.VERCEL_URL ?? null,
    region: process.env.VERCEL_REGION ?? null,
  });
}
