import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";

/** Server-only check that OPENAI_API_KEY is loaded (does not expose the key). */
export async function GET() {
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isAuthAdminEmail(user.email)) {
    return NextResponse.json({ configured: hasOpenAiApiKey() });
  }
  return NextResponse.json({ ok: true });
}
