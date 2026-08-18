/**
 * The app's one look — "Ash paper" (founder call 2026-08-18).
 *
 * Light is no longer a per-device preference, it is the app. The `rc_theme`
 * cookie, the Settings → Appearance radio group and the dark/light pair that
 * shipped on 2026-08-12 are gone: a theme switch is a question the product
 * doesn't need to ask, and a per-device choice meant the phone and the pit
 * laptop could disagree about what the app looks like. Anyone still carrying an
 * `rc_theme=dark` cookie from the old build now gets paper like everyone else —
 * nothing reads that cookie any more, and it expires on its own.
 *
 * `data-theme="light"` is still stamped on <html> (see `layout.tsx`) because
 * that attribute is what every paper colour in globals.css hangs off. The dark
 * values remain as the bare `:root` base underneath, unreferenced by the app but
 * still reachable by hand for a debug or screenshot script.
 */

/** Stamped on <html> by the root layout. The only value the app ships. */
export const APP_THEME = "light" as const;

/**
 * The page background, as a hex literal.
 *
 * The one value that genuinely cannot be read from CSS: `themeColor`,
 * `manifest.ts`, `capacitor.config.ts`, `public/offline.html` and the iOS
 * `Splash.imageset` all paint before or outside the document, so they carry
 * their own copy. Must match `--page-bg-rgb` under `[data-theme="light"]` in
 * globals.css — move them together or a launch flashes the wrong colour.
 */
export const PAGE_BG = "#EAE7E0";
