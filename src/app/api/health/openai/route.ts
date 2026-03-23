import { NextResponse } from "next/server";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";

/**
 * Server-only check that OPENAI_API_KEY is loaded (does not expose the key).
 * Use after `next dev` to confirm env — do not rely on `process.env` in the browser.
 */
export async function GET() {
  return NextResponse.json({ configured: hasOpenAiApiKey() });
}
