/**
 * Remembers which car the driver last scoped a General question to, so the next tap on
 * the General segment defaults to it (founder interview 2026-07-30). localStorage, not
 * sessionStorage — "next time" spans sessions. `""` is the explicit "No car — pure
 * theory" choice; both it and an empty store read back as null (pure theory), so the
 * distinction never leaks past this module. A restored thread's own anchor always wins
 * over this default.
 */
const STORAGE_KEY = "rc-engineer-general-car";

export function readStoredGeneralCarId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw?.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function writeStoredGeneralCarId(carId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, carId ?? "");
  } catch {
    // Private mode / storage full — the default just won't stick, which is fine.
  }
}
