const SOURCE_KIND_LABEL: Record<string, string> = {
  manual: "Manual entry",
  url: "URL import",
  screenshot: "Photo import",
  csv: "CSV import",
};

/** Returns `source.detail` when it is an http(s) URL (lap session v1). */
export function tryReadLapSourceUrl(lapSession: unknown): string | null {
  try {
    if (!lapSession || typeof lapSession !== "object") return null;
    const o = lapSession as Record<string, unknown>;
    if (o.version !== 1) return null;
    const src = o.source;
    if (!src || typeof src !== "object") return null;
    const s = src as Record<string, unknown>;
    if (s.kind !== "url") return null;
    const detail = typeof s.detail === "string" ? s.detail.trim() : "";
    if (!detail || !/^https?:\/\//i.test(detail)) return null;
    return detail;
  } catch {
    return null;
  }
}

/** Human-readable lap ingestion source for Analysis / tables. Never throws. */
export function formatLapSourceSummary(lapSession: unknown): string | null {
  try {
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
    const kindLabel = SOURCE_KIND_LABEL[kind] ?? kind;
    const bits: string[] = [kindLabel];
    if (parser && parser !== "stub") {
      const parserLabel = /liverc/i.test(parser) ? "LiveRC" : parser;
      bits.push(`(${parserLabel})`);
    }
    if (detail) bits.push(`— ${detail.length > 48 ? `${detail.slice(0, 45)}…` : detail}`);
    return bits.join(" ");
  } catch {
    return null;
  }
}
