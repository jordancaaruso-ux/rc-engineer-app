import type { EngineerMessageContextSnapshot, EngineerRatingInput } from "@/lib/engineerFeedback/types";

const MAX_NOTE_CHARS = 2000;

export function normalizeRatingStars(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 10) return null;
  return n;
}

export function normalizeRatingNote(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_NOTE_CHARS);
}

export function parseRatingInput(body: unknown): { ok: true; value: EngineerRatingInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid body" };
  }
  const raw = body as { stars?: unknown; score?: unknown };
  const stars = normalizeRatingStars(raw.score ?? raw.stars);
  if (stars == null) {
    return { ok: false, error: "score must be an integer from 0 to 10" };
  }
  const note = normalizeRatingNote((body as { note?: unknown }).note);
  const rawSnapshot = (body as { contextSnapshot?: unknown }).contextSnapshot;
  let contextSnapshot: EngineerMessageContextSnapshot | null = null;
  if (rawSnapshot != null) {
    if (typeof rawSnapshot !== "object") {
      return { ok: false, error: "contextSnapshot must be an object" };
    }
    contextSnapshot = rawSnapshot as EngineerMessageContextSnapshot;
  }
  return { ok: true, value: { stars, note, contextSnapshot } };
}

export function mergeContextSnapshots(
  base: EngineerMessageContextSnapshot,
  client?: EngineerMessageContextSnapshot | null
): EngineerMessageContextSnapshot {
  return {
    ...base,
    ...(client ?? {}),
    capturedAtIso: new Date().toISOString(),
  };
}
