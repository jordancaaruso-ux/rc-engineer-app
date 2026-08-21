/**
 * Is this `?back=` value a path on this app, or is it something someone typed?
 *
 * A single leading `/` is the whole guarantee: it makes the value a path on this
 * origin, so nothing that survives can point off-site. `//evil.example`,
 * `https://…` and `javascript:` all fail that one test.
 *
 * Extracted 2026-08-20 from `lib/rollCenter/labReturn`, which is the third
 * hand-rolled copy of these few lines in the codebase (`runs/sessionsReturn` and
 * `catalogReturn` are the others, both pinned to fixed route allowlists). The
 * existing three are left alone — they are shipped and tested — but nothing new
 * should be a fourth copy.
 */
export function safeAppPath(raw: string | string[] | undefined | null): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  /*
   * No whitespace and no control characters. A path this app wrote contains
   * neither, so their presence means something else wrote it.
   *
   * Written as a code check rather than a regex character class on purpose: the
   * class needs literal control-character escapes, and an escape that gets
   * mangled in transit turns silently into a class that rejects ordinary paths.
   * A hyphen is ordinary here (`/analysis/roll-center`) and must survive.
   */
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return trimmed;
}
