/** Azure AD B2C used by Speedhive / Sporthive (from public clientSettings). */
export const MYLAPS_B2C_TENANT = "mylapsb2cprd";
export const MYLAPS_B2C_POLICY = process.env.MYLAPS_OAUTH_POLICY?.trim() || "B2C_1A_signup_signin";

/** Speedhive web app client id (redirect URIs are locked to Speedhive domains). */
export const MYLAPS_DEFAULT_CLIENT_ID = "d9109f5a-bce9-4ff7-8c8f-71bf4fb68c40";

export function getMylapsOAuthClientId(): string {
  return process.env.MYLAPS_OAUTH_CLIENT_ID?.trim() || MYLAPS_DEFAULT_CLIENT_ID;
}

export function getMylapsOAuthClientSecret(): string | null {
  const s = process.env.MYLAPS_OAUTH_CLIENT_SECRET?.trim();
  return s || null;
}

export function mylapsOAuthConfiguredForApp(): boolean {
  return Boolean(process.env.MYLAPS_OAUTH_CLIENT_ID?.trim());
}

export function mylapsOpenIdBase(): string {
  const policy = MYLAPS_B2C_POLICY.toLowerCase();
  return `https://${MYLAPS_B2C_TENANT}.b2clogin.com/${MYLAPS_B2C_TENANT}.onmicrosoft.com/${policy}/v2.0`;
}

export function mylapsRedirectUri(origin: string): string {
  const configured = process.env.MYLAPS_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  return `${origin.replace(/\/+$/, "")}/api/mylaps/callback`;
}
