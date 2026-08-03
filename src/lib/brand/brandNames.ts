/**
 * Every user-visible name for this product, in one place.
 *
 * The product name is PROVISIONAL — "Trackside" was chosen 2026-08-03 as the working name
 * under the JRC Dynamics house brand, and the founder is not settled on it. That is exactly
 * why these are constants: the previous rename was a 19-file sweep of string literals that
 * still left three different names live at once (the in-app UI said "JRC Race Engineer", the
 * landing page said "JRC Dynamics App", and its footer said "JRC Engineering"). Changing the
 * name should be one edit here, not an archaeology exercise.
 *
 * Pure module — no `server-only`, no Next imports — so the edge middleware, client components
 * and `metadata` exports can all read it.
 *
 * THREE FILES CANNOT IMPORT THIS and carry the literal instead; grep them when the name moves:
 *   - `public/sw.js`        (served verbatim as a static asset, never bundled)
 *   - `public/offline.html` (same)
 *   - `capacitor.config.ts` (read by the Capacitor CLI outside the app's module graph;
 *                            changing `appName` also renames the installed native app)
 */

/** The product. What a driver calls the thing they log runs in. */
export const PRODUCT_NAME = "Trackside";

/** The house brand / operating business the product ships under. */
export const COMPANY_NAME = "JRC Dynamics";

/** Bare domain, for email footers and print-style brand lines. */
export const BRAND_DOMAIN = "jrcdynamics.com";

/**
 * Fallback email `from` when EMAIL_FROM is unset (local dev only — production always sets it).
 * Kept here so the sender name tracks the product name automatically.
 */
export const DEV_EMAIL_FROM = `${PRODUCT_NAME} <dev@localhost>`;
