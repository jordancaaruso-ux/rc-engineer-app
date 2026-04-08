import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import { buildEngineerContextPacketV1 } from "@/lib/engineerPhase5/contextPacket";
import { generateEngineerChatReply, type EngineerChatMessage } from "@/lib/engineerPhase5/openaiEngineer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  if (!hasOpenAiApiKey()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => null)) as
    | {
        messages?: Array<{ role?: unknown; content?: unknown }>;
      }
    | null;
  const raw = Array.isArray(body?.messages) ? body!.messages : [];
  const messages: EngineerChatMessage[] = raw
    .map((m) => {
      const role: EngineerChatMessage["role"] = m?.role === "assistant" ? "assistant" : "user";
      const content = typeof m?.content === "string" ? m.content : "";
      return { role, content };
    })
    .filter((m) => m.content.trim().length > 0)
    .slice(-8);

  const packet = await buildEngineerContextPacketV1(user.id);
  const out = await generateEngineerChatReply({ packet, messages });
  return NextResponse.json({ packet, reply: out.reply });
}

