/**
 * Shared by the website's two Apple routes (`/api/auth/apple/start` and `/callback`).
 *
 * The redirect URI must match, character for character, a Return URL registered on the Services ID
 * in the Apple Developer portal: https://www.jrcdynamics.com/api/auth/apple/callback (and the beta
 * site's). A new host needs adding there first.
 */
export const APPLE_WEB_COOKIE = "jrc_apple_web";
export const APPLE_WEB_SALT = "jrc-apple-web";

export function appleWebRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/apple/callback`;
}
