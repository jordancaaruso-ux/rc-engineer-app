/** Best-effort JWT payload decode (no signature verification). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.trim().split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const data = JSON.parse(json) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
