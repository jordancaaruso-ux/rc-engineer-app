import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { EngineerFocusedRunPairContext } from "@/lib/engineerPhase5/contextPacket";
import {
  applyEngineerFocusTool,
  listLinkedTeammatesForEngineer,
  searchRunsForEngineerTool,
  type SearchRunsForEngineerArgs,
} from "@/lib/engineerPhase5/engineerRunSearchTools";

const MODEL = "gpt-4o-mini";

function mustGetKey(): string {
  const k = getOpenAiApiKey();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

export type EngineerChatMessage = { role: "user" | "assistant"; content: string };

const CHAT_SYSTEM = `You are an RC touring car race engineer assistant.
Be conservative and grounded in the provided context JSON.

RESOLVED RUN SCOPE (highest priority for "which runs" questions):
If "resolvedRunScope" is present, the user's message was interpreted as referring to a specific set of runs (time range and/or text filter). Use "resolvedRunScope.runs" as the authoritative list of runs for that question—each entry has runId, whenLabel, car, track, session summary, lap count, best lap. Do NOT answer as if only two runs existed unless resolvedRunScope.runs has exactly two entries (or the user explicitly asks for latest vs previous). If resolvedRunScope.truncated is true, say more runs may exist than listed. If resolvedRunScope.runs is empty, say no runs matched the interpreted filter and suggest narrowing or checking dates.
When resolvedRunScope.preferOverDefaultPair is true, treat "defaultDashboardContext" (latest vs previous on the account) as background only—not as the full set of runs the user meant. "engineerSummary" may be omitted in that case; do not imply only those two runs cover the user's question.

If "focusedRunPair" is present, prioritize it for questions about comparing those runs (lap deltas, setup changedRows, importedDriversOnPrimary, fieldImportSession).
When "fieldImportSession" is non-null, it ranks imported drivers from the same timing session (best lap, gap to session best, stint fade); use it for field / class position questions vs raw lap lists.
focusedRunPair.primary and focusedRunPair.compare each include notesPreview (session notes only, may be truncated) and handlingPreview (structured handling from the log, including balance, corner phases, and severity when present) — use both.
"defaultDashboardContext" is global context (latest run on the account, etc.) and may differ from the focused primary run.
If "engineerSummary" is null but focusedRunPair has two runs, compare using focusedRunPair only (lapComparison + setupComparison).

If "patternDigest" is present, it is a chronological series for one car (oldest→newest) with lap summaries and setup keys changed vs the previous run in that series—use it for trend / "what changed" questions, not for pairwise compare unless the user ties it to focusedRunPair.

When "runCatalog" is present, it lists many of the user's runs (newest first, compact: id, car, track, event, session label, lap count, best lap). Use it as an inventory of run ids and dates—do not invent run ids. If runCatalog.truncated is true, more runs exist than listed; suggest narrowing by car, track, or date, or using Compare & pattern on the Engineer page. For detailed lap metrics, notes, and setup deltas per run, rely on focusedRunPair or patternDigest—not the catalog alone.

Setup comparison rows are authoritative when comparable is true; when comparable is false (e.g. different cars), do not infer setup differences.

If the user asks outside the context, ask a short clarifying question or explain what info is missing.
Do not invent facts or lap times. Keep answers practical and racing-specific.`;

const TOOL_INSTRUCTIONS = `

You have tools to find runs and focus the chat on specific runs:
- list_linked_teammates: use when the user mentions a teammate by name/email and you need to see who is linked.
- search_runs: filter runs by owner (you vs a linked teammate), optional date range (ISO YYYY-MM-DD), car/track/event ids, or text. Compute date ranges yourself (e.g. "last weekend" → concrete calendar dates).
- apply_engineer_focus: after you pick run ids from search_runs (or catalog), call this so the next context includes full lap/setup compare. Rules: primary_run_id MUST always be the user's own run id (owner_scope mine). compare_run_id can be the user's or a linked teammate's run id (same track as primary for teammate compares). If the user only asks about a teammate's run, search with owner_scope teammate and answer from the search results; to compare, pick a primary run of the user on the same track when possible, then apply focus.

Always use real run ids returned by search_runs or the catalog—never guess ids.`;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_linked_teammates",
      description: "List teammates linked to this account (email/name) for resolving names in search_runs.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_runs",
      description:
        "Search runs for the current user or a linked teammate. Use date_from/date_to for time windows. teammate_query is required when owner_scope is teammate.",
      parameters: {
        type: "object",
        properties: {
          owner_scope: { type: "string", enum: ["mine", "teammate"] },
          teammate_query: {
            type: "string",
            description: "Partial name or email; required when owner_scope is teammate.",
          },
          date_from: { type: "string", description: "YYYY-MM-DD inclusive" },
          date_to: { type: "string", description: "YYYY-MM-DD inclusive" },
          calendar_time_zone: {
            type: "string",
            description: "IANA timezone for local calendar day filtering (e.g. Australia/Sydney). Use when date_from/date_to mean the user's local dates.",
          },
          car_id: { type: "string" },
          track_id: { type: "string" },
          event_id: { type: "string" },
          text_contains: { type: "string", description: "Substring match on car, track, event, session label." },
          max_results: { type: "integer", description: "Default 25, max 40" },
        },
        required: ["owner_scope"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "apply_engineer_focus",
      description:
        "Load full Engineer context for a primary run (must be the user's) and optional compare run. Call when the user wants analysis/compare on specific runs you already identified.",
      parameters: {
        type: "object",
        properties: {
          primary_run_id: { type: "string", description: "Run id belonging to the current user." },
          compare_run_id: { type: "string", description: "Optional second run (yours or linked teammate's)." },
        },
        required: ["primary_run_id"],
        additionalProperties: false,
      },
    },
  },
];

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatCompletionMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function executeSearchOrListTool(
  name: string,
  argsJson: string,
  userId: string
): Promise<string> {
  try {
    const args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    if (name === "list_linked_teammates") {
      const rows = await listLinkedTeammatesForEngineer(userId);
      return JSON.stringify({
        teammates: rows.map((t) => ({
          peerUserId: t.peerUserId,
          email: t.email,
          name: t.name,
          label: t.label,
        })),
      });
    }
    if (name === "search_runs") {
      const sr = args as unknown as SearchRunsForEngineerArgs;
      const result = await searchRunsForEngineerTool(userId, {
        owner_scope: sr.owner_scope === "teammate" ? "teammate" : "mine",
        teammate_query: typeof sr.teammate_query === "string" ? sr.teammate_query : null,
        date_from: typeof sr.date_from === "string" ? sr.date_from : null,
        date_to: typeof sr.date_to === "string" ? sr.date_to : null,
        calendar_time_zone:
          typeof sr.calendar_time_zone === "string" && sr.calendar_time_zone.trim()
            ? sr.calendar_time_zone.trim()
            : null,
        car_id: typeof sr.car_id === "string" ? sr.car_id : null,
        track_id: typeof sr.track_id === "string" ? sr.track_id : null,
        event_id: typeof sr.event_id === "string" ? sr.event_id : null,
        text_contains: typeof sr.text_contains === "string" ? sr.text_contains : null,
        max_results: typeof sr.max_results === "number" ? sr.max_results : undefined,
      });
      if (!result.ok) return JSON.stringify({ error: result.error });
      return JSON.stringify({
        runs: result.runs,
        truncated: result.truncated,
      });
    }
    return JSON.stringify({ error: `Unknown tool ${name}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Tool error";
    return JSON.stringify({ error: msg });
  }
}

/** Single completion, no tools (tests and simple callers). */
export async function generateEngineerChatReply(params: {
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

/**
 * Tool-capable Engineer chat: search runs, list teammates, apply focus.
 * When apply_engineer_focus succeeds, `mergeContextWithFocusedPair` builds the next context (route supplies this).
 */
export async function generateEngineerChatReplyWithTools(params: {
  contextJson: unknown;
  messages: EngineerChatMessage[];
  userId: string;
  mergeContextWithFocusedPair: (focused: EngineerFocusedRunPairContext) => Promise<unknown>;
}): Promise<{
  reply: string;
  contextJson: unknown;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
}> {
  const apiKey = mustGetKey();
  const safeMsgs = params.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  let workingContext = params.contextJson;
  let resolvedFocus: { runId: string; compareRunId: string | null } | null = null;

  const messagesApi: ChatCompletionMessage[] = [
    { role: "system", content: CHAT_SYSTEM + TOOL_INSTRUCTIONS },
    { role: "system", content: `Context (JSON):\n${JSON.stringify(workingContext)}` },
    ...safeMsgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const MAX_ITERS = 10;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        messages: messagesApi,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (data.error as { message?: string } | undefined)?.message || `OpenAI error (${res.status})`;
      throw new Error(msg);
    }
    const choice = (data.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0];
    const msg = choice?.message;
    const toolCalls = msg?.tool_calls as ToolCall[] | undefined;
    const content = (msg?.content as string | null | undefined) ?? null;

    if (toolCalls && toolCalls.length > 0) {
      messagesApi.push({
        role: "assistant",
        content,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const name = tc.function?.name ?? "";
        const args = tc.function?.arguments ?? "{}";

        if (name === "apply_engineer_focus") {
          let argsObj: { primary_run_id?: string; compare_run_id?: string };
          try {
            argsObj = JSON.parse(args) as { primary_run_id?: string; compare_run_id?: string };
          } catch {
            messagesApi.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ error: "Invalid JSON arguments" }),
            });
            continue;
          }
          const primary = typeof argsObj.primary_run_id === "string" ? argsObj.primary_run_id.trim() : "";
          const compare =
            typeof argsObj.compare_run_id === "string" && argsObj.compare_run_id.trim()
              ? argsObj.compare_run_id.trim()
              : null;
          const applied = await applyEngineerFocusTool(params.userId, primary, compare);
          if (!applied.ok) {
            messagesApi.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: applied.error }) });
            continue;
          }
          workingContext = await params.mergeContextWithFocusedPair(applied.focusedRunPair);
          resolvedFocus = {
            runId: applied.focusedRunPair.primaryRunId,
            compareRunId: applied.focusedRunPair.compareRunId,
          };
          messagesApi[1] = {
            role: "system",
            content: `Context (JSON) — updated after apply_engineer_focus:\n${JSON.stringify(workingContext)}`,
          };
          messagesApi.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              ok: true,
              primaryRunId: applied.focusedRunPair.primaryRunId,
              compareRunId: applied.focusedRunPair.compareRunId,
            }),
          });
          continue;
        }

        const toolContent = await executeSearchOrListTool(name, args, params.userId);
        messagesApi.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
      }
      continue;
    }

    const text = typeof content === "string" ? content.trim() : "";
    return {
      reply: text || "I couldn't generate a response from the model. Try rephrasing your question.",
      contextJson: workingContext,
      resolvedFocus,
    };
  }

  return {
    reply: "Too many tool steps — try a simpler question or narrow dates.",
    contextJson: workingContext,
    resolvedFocus,
  };
}
