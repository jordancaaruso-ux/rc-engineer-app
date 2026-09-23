import { NextResponse } from "next/server";
import { engineerChatModel, engineerReasoningEffort } from "@/lib/engineer/openai";
import { ENGINEER_PROMPT_VERSION } from "@/lib/engineer/prompt";

export const dynamic = "force-dynamic";

/**
 * Which build is actually serving this request, and which Engineer is it running?
 *
 * Lives under /api/health/ because the older home, /api/_debug/version, could never be served: an
 * underscore-prefixed folder is private to the Next.js router, so it answered 404 on production and
 * beta from the day it was written. On 2026-09-19 that cost two weeks — a round of founder rulings
 * (2026-09-04) sat uncommitted in a side worktree and nobody could ask production what it ran.
 *
 * Deliberately unauthenticated (middleware lets /api/health/* through): the question it answers
 * usually comes up *because* auth sent you somewhere unexpected. Emits only build identity and the
 * Engineer's prompt label + fingerprint, model and thinking setting — no secrets. The model and
 * setting are here because an env override on Vercel would change them without a code change.
 * Check it after every deploy.
 */
export async function GET() {
  const { model } = engineerChatModel();
  return NextResponse.json({
    env: process.env.VERCEL_ENV ?? "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
    engineer: ENGINEER_PROMPT_VERSION,
    engineerModel: model,
    engineerEffort: engineerReasoningEffort(model),
    deploymentUrl: process.env.VERCEL_URL ?? null,
    region: process.env.VERCEL_REGION ?? null,
  });
}
