/**
 * Background modes — Settings → Background.
 *
 * A local-only picker for what paints behind every page. Each id maps to a
 * `html[data-bg-preview="<id>"]` block in `globals.css` that moves the four
 * `.page-bg*` layers and nothing else — card, glass and text tokens stay fixed
 * so switching compares backgrounds, not whole themes.
 *
 * The default (`black`) writes no attribute, so a fresh device gets the shipped
 * look with zero work. `bgPreviewBootstrapScript()` applies the stored choice in
 * `layout.tsx` before paint, so there is no flash of the wrong background.
 */

/** localStorage key for the background mode — local only, never synced. */
export const BG_PREVIEW_STORAGE_KEY = "rc_engineer_bg_preview";

/** @deprecated Cleared on boot; migrated to {@link BG_PREVIEW_STORAGE_KEY}. */
export const THEME_PREVIEW_STORAGE_KEY = "rc_engineer_theme_preview";

export type BgPreviewId =
  | "black"
  | "charcoal"
  | "dark-grey"
  | "graphite"
  | "photo"
  | "cool-slate"
  | "ash-warm"
  | "butter-cream"
  | "moss-tint";

/** Shipped look. Written as "no attribute" so the CSS default is the fast path. */
export const BG_PREVIEW_DEFAULT_ID: BgPreviewId = "black";

export type BgPreviewOption = {
  id: BgPreviewId;
  label: string;
  hint: string;
  /** Swatch fill for the picker — the flat base colour of the mode. */
  hex: string;
  /** Swatch overlay for modes that aren't a flat colour (photo / wash). */
  swatchImage?: string;
};

export const BG_PREVIEW_OPTIONS: ReadonlyArray<BgPreviewOption> = [
  {
    id: "black",
    label: "Black",
    hint: "Current default — pure flat black",
    hex: "#000000",
  },
  {
    id: "charcoal",
    label: "Charcoal",
    hint: "Warm graphite, the old flat base",
    hex: "#121110",
  },
  {
    id: "dark-grey",
    label: "Dark grey",
    hint: "Neutral grey, no warm cast",
    hex: "#1C1D1F",
  },
  {
    id: "graphite",
    label: "Graphite wash",
    hint: "Charcoal with soft depth gradients",
    hex: "#121110",
    swatchImage:
      "radial-gradient(120% 120% at 50% 20%, rgba(255,214,10,0.16), transparent 60%), radial-gradient(120% 120% at 50% 120%, rgba(72,68,64,0.55), transparent 70%)",
  },
  {
    id: "photo",
    label: "Track photo",
    hint: "The original blurred sunset hero",
    hex: "#121110",
    swatchImage: 'url("/brand/track-hero-baked.jpg") center / cover no-repeat',
  },
  {
    id: "cool-slate",
    label: "Cool slate",
    hint: "Blue-leaning, less brown",
    hex: "#14161C",
  },
  {
    id: "ash-warm",
    label: "Ash warm",
    hint: "Lifted warm grey",
    hex: "#1B1A17",
  },
  {
    id: "butter-cream",
    label: "Butter cream",
    hint: "Warmest — yellow-cream lift",
    hex: "#231F15",
  },
  {
    id: "moss-tint",
    label: "Moss tint",
    hint: "Faint green cast",
    hex: "#131816",
  },
];

const BG_PREVIEW_IDS = new Set<BgPreviewId>(BG_PREVIEW_OPTIONS.map((o) => o.id));

export function isBgPreviewId(v: string | null | undefined): v is BgPreviewId {
  return v != null && BG_PREVIEW_IDS.has(v as BgPreviewId);
}

export function readStoredBgPreviewId(): BgPreviewId {
  if (typeof window === "undefined") return BG_PREVIEW_DEFAULT_ID;
  try {
    const raw = window.localStorage.getItem(BG_PREVIEW_STORAGE_KEY)?.trim();
    if (raw && isBgPreviewId(raw)) return raw;
    if (raw) window.localStorage.removeItem(BG_PREVIEW_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return BG_PREVIEW_DEFAULT_ID;
}

/** Apply the mode on `<html>`; the default clears the override. */
export function applyBgPreviewToDocument(
  id: BgPreviewId = BG_PREVIEW_DEFAULT_ID
): void {
  if (typeof document === "undefined") return;
  if (id === BG_PREVIEW_DEFAULT_ID) {
    document.documentElement.removeAttribute("data-bg-preview");
  } else {
    document.documentElement.setAttribute("data-bg-preview", id);
  }
}

/** Persist the choice; safe in private mode / storage-blocked browsers. */
export function storeBgPreviewId(id: BgPreviewId): void {
  if (typeof window === "undefined") return;
  try {
    if (id === BG_PREVIEW_DEFAULT_ID) {
      window.localStorage.removeItem(BG_PREVIEW_STORAGE_KEY);
    } else {
      window.localStorage.setItem(BG_PREVIEW_STORAGE_KEY, id);
    }
  } catch {
    /* ignore */
  }
}

/** Inline bootstrap for `layout.tsx` — runs before paint to avoid a flash. */
export function bgPreviewBootstrapScript(): string {
  const valid = Array.from(BG_PREVIEW_IDS);
  const legacyKey = THEME_PREVIEW_STORAGE_KEY;
  const key = BG_PREVIEW_STORAGE_KEY;
  const fallback = BG_PREVIEW_DEFAULT_ID;
  return `(function(){try{var legacy=${JSON.stringify(legacyKey)};var k=${JSON.stringify(key)};var valid=${JSON.stringify(valid)};var d=${JSON.stringify(fallback)};var el=document.documentElement;localStorage.removeItem(legacy);var v=localStorage.getItem(k);if(!v||valid.indexOf(v)<0){if(v)localStorage.removeItem(k);el.removeAttribute("data-bg-preview");return;}if(v===d){el.removeAttribute("data-bg-preview");}else{el.setAttribute("data-bg-preview",v);}}catch(e){}})();`;
}

/** @deprecated Use {@link bgPreviewBootstrapScript}. */
export function themePreviewResetBootstrapScript(): string {
  return bgPreviewBootstrapScript();
}

/** @deprecated Use {@link applyBgPreviewToDocument}. */
export function applyThemePreviewToDocument(
  id: BgPreviewId = BG_PREVIEW_DEFAULT_ID
): void {
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
