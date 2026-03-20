/**
 * Mirrors setup from Log your run (editor + load-from-past) for Analysis compare
 * ("Current setup") and keeps them in sync across navigation.
 */
import type { SetupSnapshotData } from "@/lib/runSetup";

const STORAGE_KEY = "rc-engineer-active-setup";
export const ACTIVE_SETUP_CHANGED_EVENT = "rc-engineer-active-setup-changed";

function safeParse(raw: string | null): SetupSnapshotData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { data?: unknown };
    if (!v || typeof v.data !== "object" || v.data === null) return null;
    return v.data as SetupSnapshotData;
  } catch {
    return null;
  }
}

export function getActiveSetupData(): SetupSnapshotData | null {
  if (typeof window === "undefined") return null;
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function setActiveSetupData(data: SetupSnapshotData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ data }));
    window.dispatchEvent(new Event(ACTIVE_SETUP_CHANGED_EVENT));
  } catch {
    /* quota */
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
