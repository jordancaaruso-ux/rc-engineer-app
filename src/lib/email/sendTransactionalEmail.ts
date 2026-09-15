import "server-only";

import { createTransport } from "nodemailer";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";
import { DEV_EMAIL_FROM } from "@/lib/brand/brandNames";

/**
 * The one way the app sends a non-sign-in email (evening summaries, paid-signup way in). Same
 * SMTP as the magic links (`EMAIL_SERVER` / `EMAIL_FROM`), so there is one sender to keep on the
 * right side of SPF/DKIM/DMARC. Without SMTP configured (dev) the message is logged, not sent —
 * `sent: false` lets a caller decide whether that is fine.
 *
 * Throws when the server accepted the connection but rejected the address, so a webhook can
 * 500 and retry; a caller that would rather swallow that wraps it.
 */
export type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendTransactionalEmail(
  message: TransactionalEmail,
  options: { label?: string } = {},
): Promise<{ sent: boolean }> {
  const label = options.label ?? "email";
  if (!isMagicLinkSmtpConfigured()) {
    console.info(`[${label}] SMTP not configured — would send to ${message.to}: ${message.subject}\n${message.text}\n`);
    return { sent: false };
  }
  const transport = createTransport(process.env.EMAIL_SERVER?.trim());
  const result = await transport.sendMail({
    to: message.to,
    from: process.env.EMAIL_FROM?.trim() || DEV_EMAIL_FROM,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
  const failed = (result.rejected || []).concat(result.pending || []).filter(Boolean);
  if (failed.length) {
    throw new Error(`${label}: email to ${failed.join(", ")} could not be sent`);
  }
  return { sent: true };
}
