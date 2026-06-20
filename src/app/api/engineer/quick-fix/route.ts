import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import { generateQuickFixPayload } from "@/lib/engineerPhase5/quickFix/quickFixEngineer";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { engineerOpenAiUserMessage } from "@/lib/openAiRetry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await checkApiRateLimit(`engineer-quick-fix:${user.id}`, {
    max: 12,
    windowMs: 60_000,
  });
  if (!limited.ok) return rateLimitResponse(limited);

  if (!hasOpenAiApiKey()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 503 });
  }

  let body: { runId?: unknown };
  try {
    body = (await request.json()) as { runId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  try {
    const quickFix = await generateQuickFixPayload(user.id, runId);
    if (!quickFix) {
      return NextResponse.json(
        {
          error:
            "Run not found, not accessible, or not eligible (needs a car and completed logging).",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ quickFix });
  } catch (err) {
    const message = engineerOpenAiUserMessage(
      err instanceof Error ? err.message : "Quick fix failed"
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
