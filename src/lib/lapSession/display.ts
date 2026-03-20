/** Human-readable lap ingestion source for Analysis / tables. */
export function formatLapSourceSummary(lapSession: unknown): string | null {
  if (!lapSession || typeof lapSession !== "object") return null;
  const o = lapSession as Record<string, unknown>;
  if (o.version !== 1) return null;
  const src = o.source;
  if (!src || typeof src !== "object") return null;
  const s = src as Record<string, unknown>;
  const kind = s.kind;
  if (typeof kind !== "string") return null;
  const detail = typeof s.detail === "string" && s.detail.trim() ? s.detail.trim() : null;
  const parser = typeof s.parserId === "string" && s.parserId.trim() ? s.parserId.trim() : null;
  const bits = [kind];
  if (parser && parser !== "stub") bits.push(`(${parser})`);
  if (detail) bits.push(`— ${detail.length > 48 ? `${detail.slice(0, 45)}…` : detail}`);
  return bits.join(" ");
}
