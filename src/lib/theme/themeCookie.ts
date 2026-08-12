/**
 * Theme selection — one cookie, read on the server before the first paint.
 *
 * Per-device rather than per-account (founder call 2026-08-11), matching `rc_tz`:
 * the pit laptop and the phone are used in different light, and a theme that
 * follows you across sign-in would be wrong on one of them. It is also the only
 * shape that can be resolved during the server render, which is what makes the
 * switch flash-free — a value read from the database is fine, but a value read
 * from `localStorage` in an effect means one frame of charcoal before the paper
 * arrives, on every navigation.
 *
 * Deliberately NOT `prefers-color-scheme`. An OS that flips itself to light at a
 * night meeting is the wrong call, and the per-device background picker was
 * retired on exactly that reasoning (see globals.css) — the app has a look, and
 * this is a choice made once rather than a preference tracked continuously.
 */

/** Cookie name for the chosen theme (shared by the server stamp + the client toggle). */
export const RC_THEME_COOKIE = "rc_theme";

export type Theme = "dark" | "light";

/** The app's look unless someone has asked for otherwise. */
export const DEFAULT_THEME: Theme = "dark";

/**
 * The page background per theme, as a hex literal.
 *
 * This is the one value that genuinely cannot be read from CSS: `themeColor`,
 * `manifest.ts`, `capacitor.config.ts`, `public/offline.html` and the iOS
 * `Splash.imageset` all paint before or outside the document. Keeping the pair
 * here means the browser chrome can at least follow the theme on the two surfaces
 * that are rendered per-request (the `<meta name="theme-color">` tag and the
 * `.page-bg` fallback); the manifest and the native splash are build-time assets
 * and stay charcoal — see the note in `layout.tsx`.
 *
 * Must match `--page-bg-rgb` in globals.css for each theme.
 */
export const PAGE_BG: Record<Theme, string> = {
  dark: "#1B1A17",
  light: "#EAE7E0",
};

/**
 * Narrow an arbitrary cookie value to a theme.
 *
 * Anything unrecognised — absent, empty, tampered, or a value written by a newer
 * build that has since been rolled back — resolves to the default rather than
 * throwing, because this runs in the root layout and a crash here is a blank app.
 */
export function parseTheme(raw: string | undefined | null): Theme {
  return raw === "light" ? "light" : DEFAULT_THEME;
}

/**
 * `document.cookie` string for a theme choice.
 *
 * A year, site-wide, `SameSite=Lax`. Not `HttpOnly` on purpose: the toggle sets it
 * from the client so the change is instant, with no round trip and no reload.
 */
export function themeCookieString(theme: Theme): string {
  return `${RC_THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
