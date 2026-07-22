import { NextResponse } from "next/server";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";
import { isSignupAccessCodeConfigured } from "@/lib/auth/signupAccessCode";

/** Tells the login UI which sign-in methods are configured. */
export async function GET() {
  const gid = process.env.AUTH_GOOGLE_ID?.trim();
  const gsecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  return NextResponse.json({
    smtpConfigured: isMagicLinkSmtpConfigured(),
    googleOAuthConfigured: Boolean(gid && gsecret),
    // Drives the optional "Access code" field on /login. False = invite-only (founder adds you).
    accessCodeEnabled: isSignupAccessCodeConfigured(),
  });
}
