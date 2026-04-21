import { NextResponse } from "next/server";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";

/** Tells the login UI whether magic links are emailed or only logged server-side. */
export async function GET() {
  return NextResponse.json({
    smtpConfigured: isMagicLinkSmtpConfigured(),
  });
}
