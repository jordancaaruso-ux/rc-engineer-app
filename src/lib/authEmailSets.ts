/** Comma- or whitespace-separated email set from env (case-insensitive). */
export function parseEmailSetFromEnv(raw: string | undefined): Set<string> {
  const trimmed = raw?.trim();
  if (!trimmed) return new Set();
  return new Set(
    trimmed
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}
