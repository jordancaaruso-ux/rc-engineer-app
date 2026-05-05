/** localStorage key for dev / A-B theme previews (not user-facing product name). */
export const THEME_PREVIEW_STORAGE_KEY = "rc_engineer_theme_preview";

export type ThemePreviewId = "default" | "carbon" | "forest" | "polar" | "ember" | "runna";

export const THEME_PREVIEW_OPTIONS: ReadonlyArray<{
  id: ThemePreviewId;
  label: string;
  hint: string;
}> = [
  { id: "default", label: "A · Current", hint: "Baseline" },
  { id: "carbon", label: "B · Carbon", hint: "Neutral near-black" },
  { id: "forest", label: "C · Forest", hint: "Green-tinted black" },
  { id: "polar", label: "D · Polar", hint: "Blue-tinted black" },
  { id: "ember", label: "E · Ember", hint: "Warm brown-black" },
  {
    id: "runna",
    label: "F · Runna",
    hint: "Flat UI #161616 (runna.com --black)",
  },
];

export function isThemePreviewId(v: string | null | undefined): v is ThemePreviewId {
  return (
    v === "default" ||
    v === "carbon" ||
    v === "forest" ||
    v === "polar" ||
    v === "ember" ||
    v === "runna"
  );
}

export function readStoredThemePreviewId(): ThemePreviewId {
  if (typeof window === "undefined") return "default";
  try {
    const raw = window.localStorage.getItem(THEME_PREVIEW_STORAGE_KEY)?.trim();
    if (raw && isThemePreviewId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "default";
}

export function applyThemePreviewToDocument(id: ThemePreviewId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (id === "default") {
    el.removeAttribute("data-theme-preview");
  } else {
    el.dataset.themePreview = id;
  }
}
