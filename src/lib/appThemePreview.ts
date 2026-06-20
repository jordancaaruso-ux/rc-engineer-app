/** localStorage key for dev background preview — local only, not synced. */
export const BG_PREVIEW_STORAGE_KEY = "rc_engineer_bg_preview";

/** @deprecated Cleared on boot; migrated to {@link BG_PREVIEW_STORAGE_KEY}. */
export const THEME_PREVIEW_STORAGE_KEY = "rc_engineer_theme_preview";

export type BgPreviewId =
  | "espresso"
  | "butter-cream"
  | "cool-slate"
  | "ash-warm"
  | "moss-tint";

const BG_PREVIEW_IDS = new Set<BgPreviewId>([
  "espresso",
  "butter-cream",
  "cool-slate",
  "ash-warm",
  "moss-tint",
]);

export const BG_PREVIEW_OPTIONS: ReadonlyArray<{
  id: BgPreviewId;
  label: string;
  hint: string;
  /** Swatch fill for the settings picker */
  hex: string;
}> = [
  {
    id: "espresso",
    label: "Espresso",
    hint: "Ship default — charcoal graphite",
    hex: "#121110",
  },
  {
    id: "butter-cream",
    label: "Butter Cream",
    hint: "Warmer yellow-cream lift",
    hex: "#231F15",
  },
  {
    id: "cool-slate",
    label: "Cool Slate",
    hint: "Cooler off-tone, less brown",
    hex: "#14161C",
  },
  {
    id: "ash-warm",
    label: "Ash Warm",
    hint: "Neutral warm gray",
    hex: "#1B1A17",
  },
  {
    id: "moss-tint",
    label: "Moss Tint",
    hint: "Slightly greener / cooler",
    hex: "#131816",
  },
];

export function isBgPreviewId(v: string | null | undefined): v is BgPreviewId {
  return v != null && BG_PREVIEW_IDS.has(v as BgPreviewId);
}

export function readStoredBgPreviewId(): BgPreviewId {
  if (typeof window === "undefined") return "espresso";
  try {
    const raw = window.localStorage.getItem(BG_PREVIEW_STORAGE_KEY)?.trim();
    if (raw && isBgPreviewId(raw)) return raw;
    if (raw) window.localStorage.removeItem(BG_PREVIEW_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return "espresso";
}

/** Apply background-only preview on `<html>`; espresso clears the override. */
export function applyBgPreviewToDocument(id: BgPreviewId = "espresso"): void {
  if (typeof document === "undefined") return;
  if (id === "espresso") {
    document.documentElement.removeAttribute("data-bg-preview");
  } else {
    document.documentElement.setAttribute("data-bg-preview", id);
  }
}

/** Inline bootstrap for `layout.tsx` — runs before paint to avoid a flash. */
export function bgPreviewBootstrapScript(): string {
  const valid = Array.from(BG_PREVIEW_IDS);
  const legacyKey = THEME_PREVIEW_STORAGE_KEY;
  const key = BG_PREVIEW_STORAGE_KEY;
  return `(function(){try{var legacy=${JSON.stringify(legacyKey)};var k=${JSON.stringify(key)};var valid=${JSON.stringify(valid)};var el=document.documentElement;localStorage.removeItem(legacy);var v=localStorage.getItem(k);if(!v||valid.indexOf(v)<0){if(v)localStorage.removeItem(k);el.removeAttribute("data-bg-preview");return;}if(v==="espresso"){el.removeAttribute("data-bg-preview");}else{el.setAttribute("data-bg-preview",v);}}catch(e){}})();`;
}

/** @deprecated Use {@link bgPreviewBootstrapScript}. */
export function themePreviewResetBootstrapScript(): string {
  return bgPreviewBootstrapScript();
}

/** @deprecated Use {@link applyBgPreviewToDocument}. */
export function applyThemePreviewToDocument(id: BgPreviewId = "espresso"): void {
  applyBgPreviewToDocument(id);
}

/** @deprecated Use {@link readStoredBgPreviewId}. */
export function readStoredThemePreviewId(): BgPreviewId {
  return readStoredBgPreviewId();
}

/** @deprecated Use {@link BG_PREVIEW_OPTIONS}. */
export const THEME_PREVIEW_OPTIONS = BG_PREVIEW_OPTIONS;

/** @deprecated Use {@link BgPreviewId}. */
export type ThemePreviewId = BgPreviewId;
