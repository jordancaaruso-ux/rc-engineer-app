import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import { buildEngineerContextPacketV1 } from "@/lib/engineerPhase5/contextPacket";
import { generateEngineerSummaryV1 } from "@/lib/engineerPhase5/openaiEngineer";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  if (!hasOpenAiApiKey()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const packet = await buildEngineerContextPacketV1(user.id);
  const summary = await generateEngineerSummaryV1(packet);
  return NextResponse.json({ packet, summary });
}

