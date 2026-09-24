import { NextResponse } from "next/server";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";
import { isSignupAccessCodeConfigured } from "@/lib/auth/signupAccessCode";
import { isOpenSignupEnabled } from "@/lib/authOpenSignup";
import { isNativeShellRequest } from "@/lib/nativeShellServer";

/** Tells the login UI which sign-in methods are configured. */
export async function GET() {
  const gid = process.env.AUTH_GOOGLE_ID?.trim();
  const gsecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  const openSignup = isOpenSignupEnabled();
  const inApp = await isNativeShellRequest();
  return NextResponse.json({
    smtpConfigured: isMagicLinkSmtpConfigured(),
    // Never inside the iPhone/Android app (2026-09-24): Google hands off to Safari, which comes
    // back without the app's half of the sign-in (Auth.js InvalidCheck on the first device
    // build), and offering it would make Apple require Sign in with Apple beside it. The app
    // signs in by email + code.
    googleOAuthConfigured: Boolean(gid && gsecret) && !inApp,
    // The app has no "home" behind the sign-in form (it never shows the pitch), so the form
    // drops its "Back to home" link there.
    nativeShell: inApp,
    // Open public signup: anyone can sign in, no code. Lets the UI drop the access-code field
    // and soften "not allowed" copy.
    openSignup,
    // Drives the optional "Access code" field on /login. False = invite-only (founder adds you).
    // An access code is meaningless once signup is open, so never show the field in that mode.
    accessCodeEnabled: isSignupAccessCodeConfigured() && !openSignup,
  });
}
