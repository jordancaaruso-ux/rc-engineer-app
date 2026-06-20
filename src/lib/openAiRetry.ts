/** Shared OpenAI 429 / TPM rate-limit retry helpers (Engineer chat, eval, etc.). */

export const ENGINEER_OPENAI_BUSY_MESSAGE = "Engineer is busy — try again in ~30s";

export const DEFAULT_OPENAI_RATE_LIMIT_MAX_ATTEMPTS = 5;

export function openAiErrorMessage(data: Record<string, unknown> | undefined): string {
  return (data?.error as { message?: string } | undefined)?.message ?? "";
}

export function isOpenAiTpmRateLimitError(
  data: Record<string, unknown> | undefined,
  status?: number
): boolean {
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
