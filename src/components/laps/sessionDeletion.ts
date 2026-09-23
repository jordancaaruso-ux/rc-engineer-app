"use client";

/**
 * Deleting imported sessions from the browser, and handing the Undo to whichever page the driver
 * lands on next.
 *
 * A session deleted on its own page sends the driver back to where they opened it from — the
 * Tools card or the full list — and the Undo has to be waiting there. The two pages share no
 * state, so the ids ride in sessionStorage for a few seconds; `SessionDeletedUndo` picks them up.
 */

const DELETED_KEY = "rc_imported_session_deleted";
/** Long enough to survive a slow back-navigation; short enough that a stale one never shows. */
const FRESH_MS = 20_000;

export async function setImportedSessionsHidden(
  ids: string[],
  hidden: boolean
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/lap-time-sessions/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, hidden }),
    });
    const data = (await res.json().catch(() => null)) as { ids?: unknown; error?: unknown } | null;
    if (!res.ok) {
      return { ok: false, error: typeof data?.error === "string" ? data.error : "Couldn't change that." };
    }
    const changed = Array.isArray(data?.ids) ? data.ids.filter((v): v is string => typeof v === "string") : [];
    return { ok: true, ids: changed };
  } catch {
    return { ok: false, error: "Couldn't reach the app just now." };
  }
}

export function rememberDeletedSessions(ids: string[]): void {
  try {
    sessionStorage.setItem(DELETED_KEY, JSON.stringify({ ids, at: Date.now() }));
  } catch {
    // Private mode or blocked storage: the delete stands, only the Undo is lost.
  }
}

/** The ids deleted a moment ago on another page, once; null when there are none. */
export function takeRecentlyDeletedSessions(): string[] | null {
  try {
    const raw = sessionStorage.getItem(DELETED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DELETED_KEY);
    const parsed = JSON.parse(raw) as { ids?: unknown; at?: unknown };
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > FRESH_MS) return null;
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((v): v is string => typeof v === "string") : [];
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export function deletedSessionsMessage(count: number): string {
  return count === 1 ? "Session deleted" : `${count} sessions deleted`;
}
