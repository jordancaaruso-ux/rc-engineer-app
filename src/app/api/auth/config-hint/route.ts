import { NextResponse } from "next/server";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";
import { isSignupAccessCodeConfigured } from "@/lib/auth/signupAccessCode";
import { isOpenSignupEnabled } from "@/lib/authOpenSignup";

/** Tells the login UI which sign-in methods are configured. */
export async function GET() {
  const gid = process.env.AUTH_GOOGLE_ID?.trim();
  const gsecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  const openSignup = isOpenSignupEnabled();
  return NextResponse.json({
    smtpConfigured: isMagicLinkSmtpConfigured(),
    googleOAuthConfigured: Boolean(gid && gsecret),
    // Open public signup: anyone can sign in, no code. Lets the UI drop the access-code field
    // and soften "not allowed" copy.
    openSignup,
    // Drives the optional "Access code" field on /login. False = invite-only (founder adds you).
    // An access code is meaningless once signup is open, so never show the field in that mode.
    accessCodeEnabled: isSignupAccessCodeConfigured() && !openSignup,
  });
}
