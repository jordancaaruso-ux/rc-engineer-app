import { NextResponse } from "next/server";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";
import { isSignupAccessCodeConfigured } from "@/lib/auth/signupAccessCode";
import { isOpenSignupEnabled } from "@/lib/authOpenSignup";
import { isNativeShellRequest } from "@/lib/nativeShellServer";
import {
  googleIosClientId,
  googleWebClientId,
  isAppleSignInConfigured,
} from "@/lib/auth/social/socialConfig";

/** Tells the login UI which sign-in methods are configured. */
export async function GET() {
  const gid = process.env.AUTH_GOOGLE_ID?.trim();
  const gsecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  const openSignup = isOpenSignupEnabled();
  const inApp = await isNativeShellRequest();
  return NextResponse.json({
    smtpConfigured: isMagicLinkSmtpConfigured(),
    // The website's Google redirect. Never inside the iPhone/Android app (2026-09-24): it hands
    // off to Safari, which comes back without the app's half of the sign-in (Auth.js InvalidCheck
    // on the first device build). The app uses the phone's own Google sheet (`googleNative`).
    googleOAuthConfigured: Boolean(gid && gsecret) && !inApp,
    // Sign in with Apple, website and app (2026-09-25). Off until its key is on the server.
    appleSignIn: isAppleSignInConfigured(),
    // The app's own Google sheet (build 2 onward; the form also checks the build has the plugin).
    // These ids are public: they appear in every Google sign-in URL.
    googleNative:
      inApp && googleIosClientId() && googleWebClientId()
        ? { iosClientId: googleIosClientId(), serverClientId: googleWebClientId() }
        : null,
    // The app has no "home" behind the sign-in form (it never shows the pitch), so the form
    // drops its "Back to home" link there — and, since the app can't send a stranger to the paid
    // door either, offers its own sign-up (`/api/auth/app-signup`) and the demo instead.
    nativeShell: inApp,
    demoReady: Boolean(process.env.DEMO_USER_ID),
    // Open public signup: anyone can sign in, no code. Lets the UI drop the access-code field
    // and soften "not allowed" copy.
    openSignup,
    // Drives the optional "Access code" field on /login. False = invite-only (founder adds you).
    // An access code is meaningless once signup is open, so never show the field in that mode.
    accessCodeEnabled: isSignupAccessCodeConfigured() && !openSignup,
  });
}
