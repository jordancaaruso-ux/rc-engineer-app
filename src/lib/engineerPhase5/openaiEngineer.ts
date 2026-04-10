import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";

const MODEL = "gpt-4o-mini";

function mustGetKey(): string {
  const k = getOpenAiApiKey();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

export type EngineerChatMessage = { role: "user" | "assistant"; content: string };

const CHAT_SYSTEM = `You are an RC touring car race engineer assistant.
Be conservative and grounded in the provided context JSON.

If "focusedRunPair" is present, prioritize it for questions about comparing those runs (lap deltas, setup changedRows, importedDriversOnPrimary).
"defaultDashboardContext" is global context (latest run on the account, etc.) and may differ from the focused primary run.
If "engineerSummary" is null but focusedRunPair has two runs, compare using focusedRunPair only (lapComparison + setupComparison).

Setup comparison rows are authoritative when comparable is true; when comparable is false (e.g. different cars), do not infer setup differences.

If the user asks outside the context, ask a short clarifying question or explain what info is missing.
Do not invent facts or lap times. Keep answers practical and racing-specific.`;

export async function generateEngineerChatReply(params: {
  /** Latest deterministic Engineer Summary + optional extras */
  contextJson: unknown;
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
        { role: "system", content: `Context (JSON):\n${JSON.stringify(params.contextJson)}` },
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

