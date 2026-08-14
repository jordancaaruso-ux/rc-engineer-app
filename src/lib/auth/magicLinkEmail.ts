/**
 * The magic-link sign-in email, extracted from `auth.ts` so the paid-signup webhook
 * (`src/lib/billing/paidSignup.ts`) can send the identical email outside an Auth.js flow.
 * Pure render — no transport, no env, no side effects.
 */

import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";

export type MagicLinkEmail = { subject: string; text: string; html: string };

export function renderMagicLinkEmail(url: string, recipientEmail: string): MagicLinkEmail {
  // Escape the recipient so a crafted address can't inject markup into the footer.
  const safeEmail = recipientEmail
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return {
    subject: `Sign in to ${PRODUCT_NAME}`,
    text: [
      PRODUCT_NAME,
      "",
      "Your sign-in link. Works once, expires soon.",
      "",
      url,
      "",
      `Requested for ${recipientEmail} — not you? Ignore this.`,
    ].join("\n"),
    // Table-based, inline-styled HTML so it holds up in Outlook and the rest. Dark-first on
    // purpose: Gmail's dark mode force-inverts light emails (the old white-card design came out
    // olive-on-grey), and an already-dark surface passes through untouched. The mark is the 3x
    // PNG export of `public/brand/jrc-mark-yellow.svg` — email clients don't render SVG — served
    // from production so the image resolves no matter which environment sent the email.
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:#121110;">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="padding:0 4px 32px;">
        <img src="https://www.${BRAND_DOMAIN}/brand/jrc-mark-yellow-3x.png" width="91" height="30" alt="${PRODUCT_NAME}" style="display:block;height:30px;width:auto;border:0;" />
      </td></tr>
      <tr><td style="padding:0 4px 24px;">
        <p style="margin:0;font-size:15px;line-height:1.55;color:#D9D4CA;">Your sign-in link. Works once, expires soon.</p>
      </td></tr>
      <tr><td style="padding:0 4px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:10px;background:#FFD60A;text-align:center;">
            <a href="${url}" style="display:block;padding:15px 24px;font-size:15px;font-weight:700;color:#121110;text-decoration:none;">Sign in</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 4px 30px;">
        <p style="margin:0;font-size:12px;color:#7D786E;">Button dead? <a href="${url}" style="color:#A8A296;">Open the link directly</a>.</p>
      </td></tr>
      <tr><td style="padding:14px 4px 0;border-top:1px solid #2B2A27;">
        <p style="margin:0;font-size:11.5px;line-height:1.7;color:#7D786E;">Requested for ${safeEmail} &mdash; not you? Ignore this.<br>${PRODUCT_NAME} &middot; ${BRAND_DOMAIN}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  };
}
