import { NextResponse, after } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { parseReportInput } from "@/lib/moderation/reportRules";
import { notifyAdminsOfReport, resolveReportTarget, saveReport } from "@/lib/moderation/reports";

export const dynamic = "force-dynamic";

/**
 * Report a comment, a teammate, or a shared track, tire or chassis (App Store guideline 1.2,
 * 2026-09-26). Body: `{ kind, targetId, reason, teamId? }`. The founder is pushed and emailed;
 * a reported comment disappears for the reporter at once (`loadCommentsForRuns`).
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Every report emails the founder, so a burst is capped. Per instance, best effort.
  const rl = checkApiRateLimit({ key: `report:${user.id}`, limit: 20, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const parsed = parseReportInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const target = await resolveReportTarget(user.id, parsed.input);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await saveReport(user.id, parsed.input, target);

  after(() =>
    notifyAdminsOfReport({
      kind: parsed.input.kind,
      reason: parsed.input.reason,
      excerpt: target.excerpt,
      reporterEmail: user.email ?? null,
    })
  );

  return NextResponse.json({ ok: true });
}
