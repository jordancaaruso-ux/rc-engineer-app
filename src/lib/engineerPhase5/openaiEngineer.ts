import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { EngineerFocusedRunPairContext } from "@/lib/engineerPhase5/contextPacket";
import {
  applyEngineerFocusTool,
  listLinkedTeammatesForEngineer,
  searchRunsForEngineerTool,
  type SearchRunsForEngineerArgs,
} from "@/lib/engineerPhase5/engineerRunSearchTools";
/**
 * Some models (GPT-5 family, o-series) only allow the default sampler — sending temperature≠1 errors.
 * Omit `temperature` in the request body for those; OpenAI uses its default.
 */
function modelSupportsCustomTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o[0-9]/.test(m)) return false;
  return true;
}

function buildChatCompletionBody(
  model: string,
  temperature: number,
  rest: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, ...rest };
  if (modelSupportsCustomTemperature(model)) {
    body.temperature = temperature;
  }
  return body;
}

/**
 * Chat uses one model for all turns (conversational engineer).
 * Default gpt-5; override with ENGINEER_MODEL when you need a cheaper model at scale.
 * `temperature` is only sent when the model accepts it (see modelSupportsCustomTemperature).
 */
function getEngineerChatModelAndTemperature(): {
  model: string;
  temperature: number;
} {
  const model = process.env.ENGINEER_MODEL?.trim() || "gpt-5";
  return {
    model,
    temperature: 0.3,
  };
}

function mustGetKey(): string {
  const k = getOpenAiApiKey();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

export type EngineerChatMessage = { role: "user" | "assistant"; content: string };

const CHAT_SYSTEM = `You are an RC touring car race engineer assistant.
Be conservative and grounded in the provided context JSON.

CONVERSATION STYLE: Reply in natural prose like a human engineer. The app may show **structured** lap and setup comparison elsewhere on the page—you do **not** need a fixed report template (no required ### sections). Answer the user's actual question: a short opinion, a comparison, setup advice, or clarification. When they **do** want detail on a two-run diff, still be readable—bullet points are fine, but not mandatory. Ground technical claims in context JSON and KB; avoid generic racing clichés.

RESOLVED RUN SCOPE (highest priority for "which runs" questions):
If "resolvedRunScope" is present, the user's message was interpreted as referring to a specific set of runs (time range and/or text filter). Use "resolvedRunScope.runs" as the authoritative list of runs for that question—each entry has runId, whenLabel, car, track, session summary, lap count, best lap. Do NOT answer as if only two runs existed unless resolvedRunScope.runs has exactly two entries (or the user explicitly asks for latest vs previous). If resolvedRunScope.truncated is true, say more runs may exist than listed. If resolvedRunScope.runs is empty, say no runs matched the interpreted filter and suggest narrowing or checking dates.
When resolvedRunScope.preferOverDefaultPair is true, treat "defaultDashboardContext" (latest vs previous on the account) as background only—not as the full set of runs the user meant. "engineerSummary" may be omitted in that case; do not imply only those two runs cover the user's question.

If "focusedRunPair" is present, prioritize it for questions about comparing those runs (lap deltas, setup changedRows, setupComparison.rcEffectHints, focusedRunPair.setupCompareKbSnippets, importedDriversOnPrimary, fieldImportSession). Use focusedRunPair.primary.id and primary.whenLabel for the primary run. When a compare run exists (compare is non-null), use compare.id and compare.whenLabel—do not invent "Run 1" / "Run 2" labels that do not match these ids.
When "fieldImportSession" is non-null, it ranks imported drivers from the same timing session (best lap, gap to session best, stint fade); use it for field / class position questions vs raw lap lists.
focusedRunPair.primary and focusedRunPair.compare each include notesPreview (session notes only, may be truncated) and handlingPreview (structured handling from the log, including balance, corner phases, and severity when present) — use both.
"defaultDashboardContext" is global context (latest run on the account, etc.) and may differ from the focused primary run.
If "engineerSummary" is null but focusedRunPair has two runs, compare using focusedRunPair only (lapComparison + setupComparison).

If "patternDigest" is present, it is a chronological series for one car (oldest→newest) with lap summaries and setup keys changed vs the previous run in that series—use it for trend / "what changed" questions, not for pairwise compare unless the user ties it to focusedRunPair.

When "runCatalog" is present, it lists many of the user's runs (newest first, compact: id, car, track, event, session label, lap count, best lap). Use it as an inventory of run ids and dates—do not invent run ids. If runCatalog.truncated is true, more runs exist than listed; suggest narrowing by car, track, or date, or using Compare & pattern on the Engineer page. For detailed lap metrics, notes, and setup deltas per run, rely on focusedRunPair or patternDigest—not the catalog alone.

Setup comparison (focusedRunPair.setupComparison when comparable is true): Read setupComparison.columnReadingNote: the "primary" column is always the focused primary run's value, "compare" is the compare run's value; change compare→primary means subtracting compare from primary for shim mm (positive = raised stack on primary). changedRows include a "key" field per row. If setupComparison.rollCentreBalanceNote is non-null, read it before interpreting upper-link changes—it flags when only **one** axle’s upper-link keys changed vs compare, so you should discuss **roll-centre balance front vs rear**, not that axle in isolation. setupComparison.frontAxleNetNote and setupComparison.rearAxleNetNote (when non-null) are **deterministic combined RC + upper-link angle** summaries for that axle—**do not contradict** them. **Averaged** under–lower-arm deltas in those notes encode **roll-centre / support height** on the axle; **left–right split** for longitudinal anti geometry is separate: when non-null, use **setupComparison.frontLowerArmAntiGeometryNote** (FF−FR, **anti-dive**) and **setupComparison.rearLowerArmAntiGeometryNote** (RF−RR, **anti-squat**)—quote them verbatim in setup-compare answers alongside the axle net notes; do not confuse split with averaged RC. setupComparison.rcEffectHints gives RC direction for upper inner and under lower arm shims—**stay consistent** with those lines; do not invent opposite signs. Rows are chassis/suspension tuning only, not motor/pinion/wing/electronics. When comparable is false (e.g. different cars), do not infer setup differences.

When the user asks about setup or lap differences between the focused runs: (1) State compare→primary direction in plain words when citing shims (e.g. "compare 3.0 mm → primary 3.5 mm = raised on primary"). Say "no change" only when values normalize equal (e.g. 2 vs 2.0). (2) FF/FR/RF/RR are corners (see columnReadingNote); merged axle rows describe that axle once. (3) For handling feel, use focusedRunPair.setupCompareKbSnippets and richEngineerContext.vehicleDynamicsKb—paraphrase naturally. (4) Upper outer without rcEffectHint: do not assert a definite RC direction unless KB says so; net inner+outer sets the link line.

If "richEngineerContext" is present, use it for structured grounding: car (including setupSheetTemplate), sessionClass (from the run vs the event), tires, track (gripTags/layoutTags multi-select with gripSummary/layoutSummary for display), setupVsSpread (chassis/suspension tuning parameters only—numeric bands prefer community_eligible_uploads when setupVsSpread.communitySpreadAvailable and each row's spreadSource say so: that is all users' uploads flagged for aggregations sharing the sheet template, bucketed by track surface AND grip level via setupVsSpread.communityContext; DEFAULT BEHAVIOUR: unless the user explicitly names a grip level, treat the primary spread and percentile bands as the "any grip" archetype; each numeric row also carries communityGripLevel showing which grip bucket actually served the primary band—"low"/"medium"/"high" when the run had a traction tag, "any" otherwise or when the run-specific bucket had <10 samples for that parameter; in addition each numeric row may carry gripTrend, a partial record of low/medium/high/any buckets with {sampleCount, median, mean, min, max}—USE gripTrend (not theory) whenever the user asks about how a parameter trends or varies with grip, cite the actual low/medium/high medians, note when the deltas are small/flat ("no measurable trend across grip in the dataset") and when they're large; a missing gripTrend on a parameter means no bucket cleared the 10-sample threshold; otherwise spreadSource your_garage uses your cars with that template), conditionalSetupEmpirical (optional: your own logged runs bucketed by this track's grip/layout tag signature—median per parameter in that bucket vs your overall garage medians; only trust rows when hasEnoughData is true and respect conditionSampleCount), and vehicleDynamicsKb (retrieved excerpts of general RC vehicle dynamics). Treat conditionalSetupEmpirical as user garage data; treat setupVsSpread community bands as pooled eligible-upload statistics (not "your" uploads only) for the user's surface+grip context; treat vehicleDynamicsKb as general theory—not measured user data, and never assert a grip-vs-parameter trend from theory if gripTrend data is available that contradicts or doesn't support it. For "where is my setup vs typical", prefer setupVsSpread.positionBand and spread percentiles, and state the communityContext label (template · surface · grip level) when citing community numbers so the user knows which archetype you're comparing against. Use conditionalSetupEmpirical for "what you usually run when grip/layout looks like this track" when hasEnoughData is true. Do not treat excluded fields as setup deltas for suggestions unless the user explicitly asks about them.

SETUP DELTAS AND vehicleDynamicsKb (roll centre): When describing shim or arm changes, prefer **raise** and **lower**, not "increase/decrease" as the only wording. Never say **inner** alone—distinguish **upper inner** (upper link, keys upper_inner_shims_*) from **inner lower arm** / **under lower arm** (lower link, keys under_lower_arm_shims_*). If setupComparison.rcEffectHints includes a row for that key, follow that line for RC direction. Otherwise KB: **raising upper inner shims lowers roll centre** on that corner; **raising under–lower-arm shims raises roll centre** on that corner. **Flatter** upper link vs **more angled**—net inner + outer together. Avoid generic automotive clichés unless grounded in KB or user notes.

INNER LOWER ARM (under_lower_arm) AND SUPPORT: **Raising** inner lower adds **geometric support** and **higher RC** at that end (see **support-lower-inner** in vehicleDynamicsKb). Casual **support** language often emphasizes the **rear**; for **front** under lower arm, use KB for **front** tendencies (entry, mid–exit, **bumps**, understeer feel)—not rear-only stories unless rear keys changed. Stay consistent with **rcEffectHints** and **frontAxleNetNote** / **rearAxleNetNote**. For **anti-dive** / **anti-squat** (left–right inner lower asymmetry), use **frontLowerArmAntiGeometryNote** / **rearLowerArmAntiGeometryNote** when present—**not** the averaged lower-arm line inside the axle net note alone.

INITIAL VS OVERALL GRIP (entry / mid / exit): When the user asks about **peaky vs consistent** grip, **initial bite**, **overall grip**, or handling **into / through / off** corners, use **vehicleDynamicsKb** excerpts—especially the **initial-vs-overall-grip** KB file when present in setupCompareKbSnippets—and align with **roll-centre.md** and **frontAxleNetNote** / **rearAxleNetNote**. Under-hub keys (under_hub_shims_*) are the usual **trim** for initial vs overall after RC geometry; state that relationship when those keys appear in the diff.

UPPER INNER VS "ON / IN THE TRACK" (do not invert): In vehicleDynamicsKb, **higher** RC and a **more angled** upper link align with **on the track** (responsive, reactive, more initial bite tendency). **Lower** RC and a **flatter** link align with **in the track** (smoother, more rolled-in, often more mid-corner grip tendency). **Raising upper inner** (compare→primary) **lowers RC**—that moves **toward in the track** at that end, **not** toward "more responsive and reactive" unless a **net** change (inner+outer+lower arm together) actually raises RC. Never label an upper-inner raise as adding "responsiveness" by confusing it with higher RC.

UPPER OUTER DIRECTION (common mistake): **Lowering** upper outer shims **flattens** the upper-link contribution at that end (KB: same direction as raising inner for flattening). A **flatter** link at an end **tends toward lower RC there**, not higher. **Raising** upper outer **angles** the link more and **tends toward higher RC**. Do **not** write that a flatter link "increases roll centre" or that lowering outer "adds RC"—that contradicts vehicleDynamicsKb.

NET PER AXLE: If **upper inner**, **upper outer**, and/or **under lower arm** all change on the **same** axle (front or rear), give **one** net description of upper-link angle and RC **tendency** for that axle (inner+outer combined, then how inner lower arm stacks), not three contradictory one-liner RC claims.

ROLL CENTRE BALANCE (front vs rear): When **only the front** or **only the rear** upper-link keys appear in the diff (see rollCentreBalanceNote), after stating per-end RC direction from rcEffectHints/KB, explain **how** that changes **front vs rear roll-centre balance** per vehicleDynamicsKb (e.g. **raising front upper inner** lowers front RC—often **less initial grip**, **smoother** turn-in and **over bumps**, grip that can **hold later** into the corner and **more mid-corner steering** tendency—while the **other** axle’s upper link was **unchanged**, so the **relative** balance is what drives the familiar **upper link balance** handling effects). If both axles appear in the diff, still judge **net** per axle then **relative** balance.

RC SIGN DISCIPLINE: When discussing roll centre, do not contradict **frontAxleNetNote**, **rearAxleNetNote**, or **rcEffectHints**. **Forbidden:** claiming **raising upper inner** causes **higher** roll centre (here it **lowers** RC). **Forbidden:** **lowering** upper outer **raises** roll centre—it tends **lower**.

VOCABULARY (all messages): Do not use **responsive** for **lower RC** or **flatter** upper link. Reserve **responsive** for **on the track** / **initial bite** / **initial grip** when that is what you mean. For lower RC and flatter links, use **smoother**, **more rolled-in**, **more in the track**, **less initial bite**, **mid-corner**, **overall grip**—not "responsive."

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

  const opts = getEngineerChatModelAndTemperature();

  const messages: ChatCompletionMessage[] = [
    { role: "system", content: CHAT_SYSTEM },
    { role: "system", content: `Context (JSON):\n${JSON.stringify(params.contextJson)}` },
    ...safeMsgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildChatCompletionBody(opts.model, opts.temperature, {
        messages,
      })
    ),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (data.error as { message?: string } | undefined)?.message || `OpenAI error (${res.status})`;
    throw new Error(msg);
  }
  const lastText =
    (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content?.trim() ?? "";
  if (!lastText) {
    return { reply: "I couldn't generate a response from the model. Try rephrasing your question." };
  }
  return { reply: lastText };
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
    {
      role: "system",
      content: CHAT_SYSTEM + TOOL_INSTRUCTIONS,
    },
    { role: "system", content: `Context (JSON):\n${JSON.stringify(workingContext)}` },
    ...safeMsgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const MAX_ITERS = 10;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const opts = getEngineerChatModelAndTemperature();
    messagesApi[0] = {
      role: "system",
      content: CHAT_SYSTEM + TOOL_INSTRUCTIONS,
    };

    const useTools = true;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildChatCompletionBody(opts.model, opts.temperature, {
          messages: messagesApi,
          ...(useTools ? { tools: TOOLS, tool_choice: "auto" as const } : { tool_choice: "none" as const }),
        })
      ),
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
