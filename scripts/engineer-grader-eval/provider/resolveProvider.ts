/**
 * Provider resolution for the offline grader-eval harness.
 *
 * OpenAI and xAI (Grok) are both OpenAI-compatible at `<base>/chat/completions`, so a
 * single transport (llmChat.ts) serves both — the only difference is base URL + key.
 * This lets Grok act as scenario generator / candidate grader with ZERO production
 * touch (eval-only calls never go through src/lib). The "fair second engineer" seam,
 * which must reuse the real tool loop, is a separate Phase-3 concern (see the plan).
 */

export type LlmProviderId = "openai" | "xai";

export type ResolvedProvider = {
  id: LlmProviderId;
  baseUrl: string;
  apiKey: string;
  label: string;
};

/** Read base URL + API key for a provider from env. Throws if the key is missing. */
export function resolveProvider(id: LlmProviderId): ResolvedProvider {
  if (id === "xai") {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) throw new Error("XAI_API_KEY is not set (needed for provider=xai / Grok)");
    const baseUrl = (process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1").replace(/\/+$/, "");
    return { id, baseUrl, apiKey, label: "xai" };
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  return { id, baseUrl, apiKey, label: "openai" };
}

/** Default model per provider, overridable at the call site. */
export function defaultModelFor(id: LlmProviderId): string {
  if (id === "xai") return process.env.GRADER_XAI_MODEL?.trim() || "grok-4.5";
  return process.env.GRADER_OPENAI_MODEL?.trim() || "gpt-4o";
}
