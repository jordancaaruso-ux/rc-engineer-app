/**
 * The welcome email for someone who signed up inside the iPhone/Android app (2026-09-24). The app
 * may not show a price or point at the website to buy (App Store guideline 3.1.3), but "developers
 * can send communications outside of the app", so this email is the only place a new app driver
 * sees the plans. Its button opens the website's plans page with their address already in, so
 * the payment lands on the account they just made (the webhook matches it by email).
 *
 * Pure render: no transport, no env, no side effects. Same dark-first, table-based shape as the
 * sign-in email (`magicLinkEmail.ts`), for the same reasons: Gmail's dark mode and Outlook.
 */

import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";

export type AppWelcomePlan = {
  label: string;
  /** "Your last 15 runs", "Every run kept"… — one line, no marketing. */
  hook: string;
  /** Formatted monthly price, or null when Stripe couldn't be read. */
  monthly: string | null;
};

export type AppWelcomeEmail = { subject: string; text: string; html: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAppWelcomeEmail(input: {
  recipientEmail: string;
  plans: AppWelcomePlan[];
  /** Absolute URL of the plans page, email already filled in. */
  plansUrl: string;
}): AppWelcomeEmail {
  const email = escapeHtml(input.recipientEmail);
  const url = escapeHtml(input.plansUrl);

  const planRows = input.plans
    .map(
      (p) => `<tr>
          <td style="padding:12px 0;border-bottom:1px solid #2B2A27;">
            <span style="display:block;font-size:15px;font-weight:700;color:#F2EEE6;">${escapeHtml(p.label)}</span>
            <span style="display:block;margin-top:2px;font-size:12.5px;color:#9C978D;">${escapeHtml(p.hook)}</span>
          </td>
          <td align="right" style="padding:12px 0;border-bottom:1px solid #2B2A27;white-space:nowrap;vertical-align:top;">
            ${p.monthly ? `<span style="font-size:15px;font-weight:700;color:#F2EEE6;">${escapeHtml(p.monthly)}</span><span style="font-size:12px;color:#9C978D;"> / month</span>` : ""}
          </td>
        </tr>`
    )
    .join("");

  return {
    subject: `Welcome to ${PRODUCT_NAME}`,
    text: [
      `Welcome to ${PRODUCT_NAME}`,
      "",
      "You're signed up. Pick a plan to open your garage:",
      "",
      ...input.plans.map((p) => `- ${p.label}${p.monthly ? `, ${p.monthly} a month` : ""}: ${p.hook}`),
      "",
      `Choose your plan: ${input.plansUrl}`,
      "",
      "Full refund in the first 14 days. Then go back to the app to get set up.",
      "",
      `You signed up in the ${PRODUCT_NAME} app as ${input.recipientEmail}. Not you? Ignore this.`,
    ].join("\n"),
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:#121110;">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="padding:0 4px 32px;">
        <img src="https://www.${BRAND_DOMAIN}/brand/jrc-mark-yellow-3x.png" width="91" height="30" alt="${PRODUCT_NAME}" style="display:block;height:30px;width:auto;border:0;" />
      </td></tr>
      <tr><td style="padding:0 4px 8px;">
        <p style="margin:0;font-size:24px;line-height:1.2;font-weight:700;color:#F2EEE6;">You&rsquo;re signed up.</p>
      </td></tr>
      <tr><td style="padding:0 4px 18px;">
        <p style="margin:0;font-size:15px;line-height:1.55;color:#D9D4CA;">Pick a plan to open your garage.</p>
      </td></tr>
      <tr><td style="padding:0 4px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #2B2A27;">${planRows}</table>
      </td></tr>
      <tr><td style="padding:0 4px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:10px;background:#FFD60A;text-align:center;">
            <a href="${url}" style="display:block;padding:14px 24px;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#121110;text-decoration:none;">Choose your plan</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 4px 30px;">
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:#9C978D;">Full refund in the first 14 days. Then go back to the app to get set up.</p>
      </td></tr>
      <tr><td style="padding:14px 4px 0;border-top:1px solid #2B2A27;">
        <p style="margin:0;font-size:11.5px;line-height:1.7;color:#7D786E;">You signed up in the ${PRODUCT_NAME} app as ${email} &mdash; not you? Ignore this.<br>${PRODUCT_NAME} &middot; ${BRAND_DOMAIN}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  };
}
