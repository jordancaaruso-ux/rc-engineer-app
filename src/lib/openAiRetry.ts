/** Shared OpenAI 429 / TPM rate-limit retry helpers (Engineer chat, eval, etc.). */

export const ENGINEER_OPENAI_BUSY_MESSAGE = "Engineer is busy — try again in ~30s";

/** OpenAI refused for billing (credit gone, card declined). The driver can do nothing about it. */
export const ENGINEER_OPENAI_UNAVAILABLE_MESSAGE = "Engineer is unavailable right now — try again later";

/** One call ran past `engineerOpenAiCallTimeoutMs`. */
export const ENGINEER_OPENAI_TIMEOUT_MESSAGE = "Engineer took too long to answer — try again";

export const DEFAULT_OPENAI_RATE_LIMIT_MAX_ATTEMPTS = 5;

/**
 * Longest the Engineer waits, in total, between retries of one call. The route dies at 120 s, and
 * OpenAI can ask for waits of a minute or more; past this the driver is better told "busy" now
 * than handed a dead stream later (2026-09-24 launch audit).
 */
export const OPENAI_RETRY_WAIT_BUDGET_MS = 40_000;

const DEFAULT_ENGINEER_OPENAI_CALL_TIMEOUT_MS = 75_000;

/**
 * Ceiling on one OpenAI call, stream included. Without it a stalled call ran until Vercel killed
 * the route at 120 s and the driver got a blank answer. Answers take 10–26 s; the eval harness
 * can raise it with ENGINEER_OPENAI_TIMEOUT_MS for slow settings.
 */
export function engineerOpenAiCallTimeoutMs(): number {
  const n = Number(process.env.ENGINEER_OPENAI_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 5_000 ? Math.floor(n) : DEFAULT_ENGINEER_OPENAI_CALL_TIMEOUT_MS;
}

export function openAiErrorMessage(data: Record<string, unknown> | undefined): string {
  return (data?.error as { message?: string } | undefined)?.message ?? "";
}

const QUOTA_MESSAGE = /exceeded your current quota|insufficient_quota|billing hard limit/i;

/**
 * Out of prepaid credit, or a billing limit reached. OpenAI answers it with a 429 like a rate
 * limit, but waiting never fixes it — so it is never retried, and never shown raw to a driver.
 */
export function isOpenAiQuotaExhaustedError(data: Record<string, unknown> | undefined): boolean {
  const err = data?.error as { code?: string; type?: string } | undefined;
  if (err?.code === "insufficient_quota" || err?.type === "insufficient_quota") return true;
  return QUOTA_MESSAGE.test(openAiErrorMessage(data));
}

export function isOpenAiTpmRateLimitError(
  data: Record<string, unknown> | undefined,
  status?: number
): boolean {
  if (isOpenAiQuotaExhaustedError(data)) return false;
  if (status === 429) return true;
  const msg = openAiErrorMessage(data);
  return /tokens per min|rate_limit_exceeded|rate limit reached/i.test(msg);
}

/** Parse "Please try again in 12.298s" or "388ms" from OpenAI error bodies. */
export function parseOpenAiRetryAfterMs(data: Record<string, unknown> | undefined): number {
  const msg = openAiErrorMessage(data);
  const secMatch = msg.match(/try again in ([\d.]+)\s*s(?:ec(?:ond)?s?)?/i);
  if (secMatch) {
    const sec = parseFloat(secMatch[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(120_000, Math.max(500, Math.round(sec * 1000)));
    }
  }
  const msMatch = msg.match(/try again in (\d+)\s*ms/i);
  if (msMatch) {
    return Math.min(15_000, Math.max(200, Number(msMatch[1])));
  }
  return 1000;
}

/** Wait at least OpenAI's suggested delay, with exponential backoff and jitter. */
export function computeOpenAiRetryDelayMs(
  suggestedMs: number,
  attempt: number,
  baseMs = 1000
): number {
  const exponential = baseMs * 2 ** attempt;
  const waitMs = Math.max(suggestedMs, exponential);
  const jitter = 50 + Math.floor(Math.random() * 250);
  return Math.min(120_000, waitMs + jitter);
}

export function isOpenAiRateLimitMessage(message: string): boolean {
  return /tokens per min|rate_limit_exceeded|rate limit reached/i.test(message);
}

export function engineerOpenAiUserMessage(rawMessage: string): string {
  // Billing first: its text can also mention rate limits, and it must never reach a driver raw.
  if (QUOTA_MESSAGE.test(rawMessage)) {
    return ENGINEER_OPENAI_UNAVAILABLE_MESSAGE;
  }
  if (isOpenAiRateLimitMessage(rawMessage)) {
    return ENGINEER_OPENAI_BUSY_MESSAGE;
  }
  return rawMessage;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function maxOpenAiRateLimitAttempts(): number {
  const n = Number(process.env.ENGINEER_OPENAI_MAX_RETRIES);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_OPENAI_RATE_LIMIT_MAX_ATTEMPTS;
}
