import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { EngineerContextPacketV1 } from "@/lib/engineerPhase5/contextPacket";

const MODEL = "gpt-4o-mini";

function mustGetKey(): string {
  const k = getOpenAiApiKey();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

export type EngineerSummaryV1 = {
  whatChanged: string[];
  whatStandsOut: string[];
  possibleExplanations: string[];
  thingsToConsiderNext: string[];
  notes?: string | null;
};

const SUMMARY_SYSTEM = `You are an RC touring car race engineer assistant.

You MUST be conservative by default:
- If evidence is weak or missing, say so.
- Prefer small, testable suggestions over big changes.
- Do not claim setup cause/effect unless the context supports it.

You will be given a structured JSON context packet from the app.
Return ONLY valid JSON (no markdown) matching this shape:
{
  "whatChanged": string[],
  "whatStandsOut": string[],
  "possibleExplanations": string[],
  "thingsToConsiderNext": string[],
  "notes": string | null
}

Rules:
- Keep each string short (1–2 sentences).
- Do not invent track temperature, grip, tyre compound, or exact setup values unless provided.
- If there is no previous run, focus on interpreting the latest run and the things-to-try list.`;

export async function generateEngineerSummaryV1(packet: EngineerContextPacketV1): Promise<EngineerSummaryV1> {
  const apiKey = mustGetKey();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SUMMARY_SYSTEM },
        {
          role: "user",
          content: `Context packet (JSON):\n${JSON.stringify(packet)}`,
        },
      ],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (data.error as { message?: string } | undefined)?.message || `OpenAI error (${res.status})`;
    throw new Error(msg);
  }
  const text =
    (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content?.trim() ?? "";
  const parsed = JSON.parse(text) as EngineerSummaryV1;
  return {
    whatChanged: Array.isArray(parsed.whatChanged) ? parsed.whatChanged.filter((s): s is string => typeof s === "string") : [],
    whatStandsOut: Array.isArray(parsed.whatStandsOut) ? parsed.whatStandsOut.filter((s): s is string => typeof s === "string") : [],
    possibleExplanations: Array.isArray(parsed.possibleExplanations)
      ? parsed.possibleExplanations.filter((s): s is string => typeof s === "string")
      : [],
    thingsToConsiderNext: Array.isArray(parsed.thingsToConsiderNext)
      ? parsed.thingsToConsiderNext.filter((s): s is string => typeof s === "string")
      : [],
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
  };
}

export type EngineerChatMessage = { role: "user" | "assistant"; content: string };

const CHAT_SYSTEM = `You are an RC touring car race engineer assistant.
Be conservative and grounded in the provided context packet.
If the user asks outside the context, ask a short clarifying question or explain what info is missing.
Do not invent facts. Keep answers practical and racing-specific.`;

export async function generateEngineerChatReply(params: {
  packet: EngineerContextPacketV1;
  messages: EngineerChatMessage[];
}): Promise<{ reply: string }> {
  const apiKey = mustGetKey();
  const safeMsgs = params.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: CHAT_SYSTEM },
        { role: "system", content: `Context packet (JSON):\n${JSON.stringify(params.packet)}` },
        ...safeMsgs,
      ],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (data.error as { message?: string } | undefined)?.message || `OpenAI error (${res.status})`;
    throw new Error(msg);
  }
  const text =
    (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content?.trim() ?? "";
  return { reply: text || "I couldn't generate a response from the model. Try rephrasing your question." };
}

