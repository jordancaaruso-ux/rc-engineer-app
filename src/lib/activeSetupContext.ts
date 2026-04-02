/**
 * Mirrors setup from Log your run (editor + load-from-past) for Analysis compare
 * ("Current setup") and keeps them in sync across navigation.
 * Stores optional carId so "current setup" is not mixed across vehicles.
 */
import type { SetupSnapshotData } from "@/lib/runSetup";

const STORAGE_KEY = "rc-engineer-active-setup";
export const ACTIVE_SETUP_CHANGED_EVENT = "rc-engineer-active-setup-changed";

type StoredPayload = {
  data: SetupSnapshotData;
  /** Car this setup belongs to; null = unknown / legacy / Setup page without context */
  carId?: string | null;
};

function safeParseFull(raw: string | null): StoredPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { data?: unknown; carId?: unknown };
    if (!v || typeof v.data !== "object" || v.data === null) return null;
    const carId =
      typeof v.carId === "string" && v.carId.trim()
        ? v.carId.trim()
        : v.carId === null
          ? null
          : null;
    return { data: v.data as SetupSnapshotData, carId };
  } catch {
    return null;
  }
}

export function getActiveSetupData(): SetupSnapshotData | null {
  if (typeof window === "undefined") return null;
  return safeParseFull(window.localStorage.getItem(STORAGE_KEY))?.data ?? null;
}

/** Car associated with the active setup snapshot (if any). */
export function getActiveSetupCarId(): string | null {
  if (typeof window === "undefined") return null;
  return safeParseFull(window.localStorage.getItem(STORAGE_KEY))?.carId ?? null;
}

/**
 * Persist active setup. When `carId` is omitted, the previous stored car id is kept
 * (e.g. Setup page edits without changing vehicle context).
 */
export function setActiveSetupData(data: SetupSnapshotData, carId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const prev = safeParseFull(window.localStorage.getItem(STORAGE_KEY));
    const nextCar =
      carId !== undefined ? (typeof carId === "string" && carId.trim() ? carId.trim() : null) : (prev?.carId ?? null);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, carId: nextCar } satisfies StoredPayload));
    window.dispatchEvent(new Event(ACTIVE_SETUP_CHANGED_EVENT));
  } catch {
    /* quota */
  }
}

/** Clear stored car context (e.g. after explicit "clear setup"). */
export function clearActiveSetupCarContext() {
  if (typeof window === "undefined") return;
  try {
    const prev = safeParseFull(window.localStorage.getItem(STORAGE_KEY));
    if (!prev) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ data: prev.data, carId: null } satisfies StoredPayload)
    );
    window.dispatchEvent(new Event(ACTIVE_SETUP_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** Remove legacy key from older Analyze "Load setup" flow. */
export function migrateLegacyLoadedSetup() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("rc-engineer-loaded-setup");
  } catch {
    /* ignore */
  }
}
