import "server-only";

/**
 * Who we are to Apple and Google. None of these ids is secret (each appears in the sign-in URL
 * or inside the app); only `APPLE_SIGNIN_PRIVATE_KEY` is. See docs/TESTFLIGHT.md "Sign in with
 * Apple and Google" for where each one comes from.
 *
 *   APPLE_SIGNIN_KEY_ID       10-character id of the Sign in with Apple key (.p8)
 *   APPLE_SIGNIN_PRIVATE_KEY  contents of that .p8 (literal \n escapes are tolerated)
 *   APPLE_SIGNIN_SERVICES_ID  the website's Services ID; defaults to com.rcengineer.web
 *   APPLE_TEAM_ID             defaults to APNS_TEAM_ID (same team)
 *   GOOGLE_IOS_CLIENT_ID      the iPhone app's Google client; the web client is AUTH_GOOGLE_ID
 */

/** The app's bundle id: the audience of every Apple token the iPhone app gets. */
export function appleAppClientId(): string {
  return process.env.APNS_BUNDLE_ID?.trim() || "com.rcengineer.app";
}

/** The website's Services ID: the audience of every Apple token the website gets. */
export function appleWebClientId(): string {
  return process.env.APPLE_SIGNIN_SERVICES_ID?.trim() || "com.rcengineer.web";
}

export function appleTeamId(): string | null {
  return (process.env.APPLE_TEAM_ID ?? process.env.APNS_TEAM_ID)?.trim() || null;
}

export function appleKeyId(): string | null {
  return process.env.APPLE_SIGNIN_KEY_ID?.trim() || null;
}

export function applePrivateKey(): string | null {
  const raw = process.env.APPLE_SIGNIN_PRIVATE_KEY?.trim();
  if (!raw) return null;
  // Vercel/dotenv commonly store the PEM with escaped newlines.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/**
 * Apple is offered only with its key in place. The key signs the requests that fetch the token
 * Delete account uses to disconnect Apple, which Apple requires of every app that offers it.
 */
export function isAppleSignInConfigured(): boolean {
  return Boolean(appleKeyId() && applePrivateKey() && appleTeamId());
}

export function googleWebClientId(): string | null {
  return process.env.AUTH_GOOGLE_ID?.trim() || null;
}

export function googleIosClientId(): string | null {
  return process.env.GOOGLE_IOS_CLIENT_ID?.trim() || null;
}

/** Every audience a Google token for Trackside may carry: the iPhone app asks for the web
 * client as its "server client", so its tokens usually carry the web id too. */
export function googleAudiences(): string[] {
  return [googleWebClientId(), googleIosClientId()].filter((id): id is string => Boolean(id));
}
