/**
 * "Not now" on the lap step's "N other runs from today aren't logged" prompt, remembered.
 *
 * The prompt opens the moment a session lands on a run. Say no to runs 2 and 3 while logging
 * run 4, and logging run 5 an hour later must not ask about 2 and 3 all over again — the
 * checkbox under the laps strip still offers them, quietly. Keyed by session URL because that is
 * the one thing a timing session keeps across scans; kept on the device, not the account, since
 * it is only ever about not nagging this phone.
 */

export const BACKFILL_DECLINED_STORAGE_KEY = "run-form:backfill-declined:v1";

/** Older than this and a "no" has expired — the same URL can only come back on a rescan of a stale day. */
const DECLINED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type DeclinedStore = Record<string, string>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readDeclined(storage: StorageLike | null = defaultStorage(), now = Date.now()): DeclinedStore {
  if (!storage) return {};
  try {
    const raw = storage.getItem(BACKFILL_DECLINED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: DeclinedStore = {};
    for (const [url, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at !== "string") continue;
      const t = new Date(at).getTime();
      if (Number.isNaN(t) || now - t > DECLINED_TTL_MS) continue;
      out[url] = at;
    }
    return out;
  } catch {
    return {};
  }
}

/** Remember "not now" for these sessions. Returns the store as written. */
export function declineSessions(
  urls: readonly string[],
  storage: StorageLike | null = defaultStorage(),
  now = Date.now()
): DeclinedStore {
  const next = readDeclined(storage, now);
  const stamp = new Date(now).toISOString();
  for (const url of urls) {
    const key = url.trim();
    if (key) next[key] = stamp;
  }
  try {
    storage?.setItem(BACKFILL_DECLINED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full store: the prompt simply asks again next time.
  }
  return next;
}

/** The sessions the driver has not yet said no to — the prompt only opens when this is non-empty. */
export function undeclinedSessions<T extends { sessionUrl: string }>(
  sessions: readonly T[],
  declined: DeclinedStore
): T[] {
  return sessions.filter((s) => !(s.sessionUrl.trim() in declined));
}
