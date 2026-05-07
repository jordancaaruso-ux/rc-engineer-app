/**
 * Persists the Engineer "target" (primary) run chosen from Sessions so row-level
 * “Set comparison” can build `/engineer?runId=<target>&compareRunId=<this>` URLs.
 */
export const ENGINEER_SESSIONS_TARGET_RUN_ID_KEY = "rc_engineer_target_run_id";

export const ENGINEER_SESSIONS_TARGET_UPDATED_EVENT = "rc-engineer-sessions-target-updated";

export function readEngineerSessionsTargetRunId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(ENGINEER_SESSIONS_TARGET_RUN_ID_KEY);
  } catch {
    return null;
  }
}

export function persistEngineerSessionsTargetRunId(runId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ENGINEER_SESSIONS_TARGET_RUN_ID_KEY, runId);
    window.dispatchEvent(new Event(ENGINEER_SESSIONS_TARGET_UPDATED_EVENT));
  } catch {
    /* ignore quota / private mode */
  }
}
