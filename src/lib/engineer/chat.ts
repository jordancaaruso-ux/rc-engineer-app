import "server-only";

import { loadFullVehicleDynamicsKb } from "@/lib/engineer/kb";
import { ENGINEER_NETS_HEADER, loadNets } from "@/lib/engineer/nets";
import { holdBackNextQuestions, splitNextQuestions } from "@/lib/engineer/nextQuestions";
import { rcGuardCorrections, rcLeversFromNets } from "@/lib/engineer/rcDirections";
import { engineerOpenAiUserMessage } from "@/lib/openAiRetry";
import {
  buildEngineerMessages,
  standardEngineerBlocks,
  type EngineerChatMessage,
  type EngineerPayloadBlock,
} from "@/lib/engineer/payload";
import {
  buildChatCompletionBody,
  engineerChatModel,
  isContextTooLargeOpenAiError,
  mustGetOpenAiKey,
  postChatCompletion,
  responsesApiEnabled,
  type ChatCompletionMessage,
  type OpenAiUsagePayload,
  type ToolCall,
} from "@/lib/engineer/openai";
import { MAX_TOOL_CALLS_PER_ANSWER, type EngineerTools } from "@/lib/engineer/toolTypes";

export type EngineerChatUsage = {
  promptTokens: number;
  completionTokens: number;
  completionCalls: number;
  /**
   * Prompt tokens OpenAI served from cache. The KB is ~14K tokens resent every turn, and
   * this is the only evidence that the byte-stable prefix is actually being cached rather
   * than re-billed. Watch it: if it drops to zero, something upstream started varying the
   * prefix.
   */
  cachedPromptTokens: number;
};

function readUsage(data: Record<string, unknown> | undefined): EngineerChatUsage | null {
  const u = data?.usage as OpenAiUsagePayload | undefined;
  if (!u || typeof u.prompt_tokens !== "number") return null;
  return {
    promptTokens: u.prompt_tokens,
    completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
    completionCalls: 1,
    cachedPromptTokens:
      typeof u.prompt_tokens_details?.cached_tokens === "number"
        ? u.prompt_tokens_details.cached_tokens
        : 0,
  };
}

export async function generateEngineerChatReply(params: {
  messages: EngineerChatMessage[];
  onToken?: (delta: string) => void;
  /**
   * Payload override for the eval harness — an "arm" supplies its own ordered blocks.
   * Omitted (the shipped path) means KB + nets + prompt (the v1-nets composition,
   * shipped by founder call 2026-08-25 — see the north star changelog).
   */
  blocks?: EngineerPayloadBlock[];
  /**
   * Per-turn driver-data blocks (driverData.ts). Appended after every stable block so
   * the cached prefix never varies; [] (the default) is the data-less request.
   */
  driverBlocks?: EngineerPayloadBlock[];
  /**
   * What the model may call this answer (toolTypes.ts; the live executor is tools.ts). Omitted
   * (the default, and every request with no subject) means no tools on the wire and a request
   * byte-identical to before tools existed.
   */
  tools?: EngineerTools;
}): Promise<{ reply: string; nextQuestions: string[]; usage: EngineerChatUsage | null; model: string }> {
  const apiKey = mustGetOpenAiKey();
  // The follow-up line (nextQuestions.ts) is held back from the live stream as it arrives, so the
  // driver never sees `[[next: …]]` flash up before the buttons replace it.
  const stream = params.onToken ? holdBackNextQuestions(params.onToken) : null;
  const onToken = stream ? stream.push : undefined;
  const kb = await loadFullVehicleDynamicsKb();
  if (kb.files.length === 0) {
    throw new Error("The vehicle-dynamics knowledge base is empty — the Engineer has nothing to reason from.");
  }

  let blocks: EngineerPayloadBlock[];
  if (params.blocks) {
    blocks = params.blocks;
  } else {
    // The shipped payload: KB, nets, prompt — cache-stable in that order (north star §3).
    // Composition matches the harness's v1-nets arm byte for byte, so eval results on
    // that arm keep describing the shipped Engineer.
    const nets = await loadNets({ discipline: "touring" });
    const [kbBlock, promptBlock] = standardEngineerBlocks(kb.markdown);
    blocks = [kbBlock];
    if (nets.text.trim().length > 0) {
      blocks.push({ id: "nets", cacheStable: true, content: ENGINEER_NETS_HEADER + nets.text });
    }
    blocks.push(promptBlock);
  }
  if (params.driverBlocks && params.driverBlocks.length > 0) {
    blocks = [...blocks, ...params.driverBlocks];
  }
  const { model, temperature } = engineerChatModel();
  let messages: ChatCompletionMessage[] = buildEngineerMessages(blocks, params.messages);
  // Tools ride only on the Responses path: the Chat Completions escape hatch's stream reader
  // never accumulated tool calls, and a call there would surface as an empty answer.
  const toolDefs = responsesApiEnabled() ? (params.tools?.definitions ?? []) : [];
  const bodyFor = (msgs: ChatCompletionMessage[]) =>
    buildChatCompletionBody(model, temperature, {
      messages: msgs,
      ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
    });

  let res = await postChatCompletion(apiKey, bodyFor(messages), onToken);

  // One degradation, not a ladder. The whole request is ~16K tokens against a 500K-TPM
  // pool, so the only realistic way to be too large is a conversation that has run very
  // long — drop back to the question on its own rather than shrinking the KB, which is the
  // part worth keeping.
  if (!res.ok && isContextTooLargeOpenAiError(res.data)) {
    const lastUser = [...params.messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      console.warn("[engineer-chat] request too large — retrying with the latest question only");
      messages = buildEngineerMessages(blocks, [lastUser]);
      res = await postChatCompletion(apiKey, bodyFor(messages), onToken);
    }
  }

  // Tool rounds (founder call 2026-09-22): when the model asks for a read instead of
  // answering, run it, hand the text back as the tool's result, and ask again — the whole
  // conversation resent each time, tool calls and results included, because the Engineer is
  // stateless. The executor caps the calls; the round cap here is the backstop for a model
  // that keeps asking after being told there are no more reads. On a tool-call round the
  // reader has already held back any prose (the model talking to itself), so nothing reaches
  // the driver until the model answers.
  const usageTotal: EngineerChatUsage = { promptTokens: 0, completionTokens: 0, completionCalls: 0, cachedPromptTokens: 0 };
  const addUsage = () => {
    const u = readUsage(res.data);
    if (!u) return;
    usageTotal.promptTokens += u.promptTokens;
    usageTotal.completionTokens += u.completionTokens;
    usageTotal.completionCalls += u.completionCalls;
    usageTotal.cachedPromptTokens += u.cachedPromptTokens;
  };
  for (let round = 0; params.tools && toolDefs.length > 0 && res.ok && round <= MAX_TOOL_CALLS_PER_ANSWER; round++) {
    const calls = toolCallsOf(res);
    if (!calls || calls.length === 0) break;
    addUsage();
    messages = [...messages, { role: "assistant", content: contentOf(res) || null, tool_calls: calls }];
    for (const call of calls) {
      params.tools.onCall?.(call.function.name);
      const result = await params.tools.run(call.function.name, call.function.arguments);
      messages = [...messages, { role: "tool", tool_call_id: call.id, content: result }];
    }
    params.tools.onAnswering?.();
    res = await postChatCompletion(apiKey, bodyFor(messages), onToken);
  }

  if (!res.ok) {
    const rawMsg =
      (res.data?.error as { message?: string } | undefined)?.message ||
      `OpenAI error (${res.status})`;
    throw new Error(engineerOpenAiUserMessage(rawMsg));
  }
  addUsage();
  stream?.flush();

  // The follow-up line comes off before anything else reads the reply: the guard below appends
  // after the answer, and a correction written after the line would strand it mid-text.
  const split = splitNextQuestions(contentOf(res).trim());
  let reply = split.text;

  // Deterministic roll-centre direction guard (rcDirections.ts, founder call 2026-09-01):
  // a shim-move/RC-direction pairing that contradicts the solver-checked table, or a move
  // sized as a roll-centre distance, gets its correction appended — to the live stream too,
  // which is still open here — so an inverted direction never reaches the driver uncorrected.
  if (reply) {
    const netsForGuard = await loadNets({ discipline: "touring" });
    const corrections = rcGuardCorrections(reply, rcLeversFromNets(netsForGuard.entries));
    if (corrections.length > 0) {
      const tail = "\n\n" + corrections.join("\n");
      console.warn(`[engineer-rc-guard] ${corrections.length} correction(s) appended: ${corrections.join(" | ")}`);
      params.onToken?.(tail);
      reply += tail;
    }
  }

  return {
    reply:
      reply ||
      "I couldn't generate a response from the model. Try rephrasing your question.",
    nextQuestions: reply ? split.nextQuestions : [],
    usage: usageTotal.completionCalls > 0 ? usageTotal : null,
    model,
  };
}

type CompletionResult = Awaited<ReturnType<typeof postChatCompletion>>;

/** The model's prose from either transport path — empty when the round was a tool call alone. */
function contentOf(res: CompletionResult): string {
  if (res.streamResult != null) return res.streamResult.content ?? "";
  return (res.data?.choices as Array<{ message?: { content?: string | null } }> | undefined)?.[0]?.message?.content ?? "";
}

function toolCallsOf(res: CompletionResult): ToolCall[] | null {
  if (res.streamResult != null) return res.streamResult.toolCalls;
  const calls = (res.data?.choices as Array<{ message?: { tool_calls?: ToolCall[] } }> | undefined)?.[0]?.message?.tool_calls;
  return Array.isArray(calls) && calls.length > 0 ? calls : null;
}

/**
 * Eval-harness entry point: one question in, one answer out, with an optional payload
 * override so an arm can swap the prompt or add blocks without touching the shipped path.
 */
export async function runEngineerChatTurn(params: {
  question: string;
  blocks?: EngineerPayloadBlock[];
  onToken?: (delta: string) => void;
}): Promise<{ reply: string; nextQuestions: string[]; usage: EngineerChatUsage | null; model: string }> {
  return generateEngineerChatReply({
    messages: [{ role: "user", content: params.question.trim() }],
    blocks: params.blocks,
    onToken: params.onToken,
  });
}
