import "server-only";

/**
 * OpenAI API key — only available in server contexts (Route Handlers, Server Components,
 * Server Actions). Next.js does not expose non-NEXT_PUBLIC_* vars to the browser; checking
 * `process.env.OPENAI_API_KEY` in the client console will always be falsy.
 */
export function getOpenAiApiKey(): string | undefined {
  const v = process.env.OPENAI_API_KEY?.trim();
  return v ? v : undefined;
}

export function hasOpenAiApiKey(): boolean {
  return Boolean(getOpenAiApiKey());
}
