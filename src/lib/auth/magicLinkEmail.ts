/**
 * The sign-in email, extracted from `auth.ts` so the paid-signup webhook
 * (`src/lib/billing/paidSignup.ts`) can send the identical email outside an Auth.js flow.
 * Pure render — no transport, no env, no side effects.
 *
 * THE CODE LEADS, THE LINK FOLLOWS. A link only ever lands where the OS decides to open it: ask
 * for one in Safari on an iPhone and Mail hands it to whatever the default browser is, which
 * signs you into *that* browser's cookie jar and leaves the one you were looking at empty. The
 * code is carried back by the human instead, so it survives the wrong browser, the wrong device,
 * the Capacitor webview, and corporate mail scanners that pre-click links and burn them.
 *
 * The code is in the SUBJECT as well as the body, so it can be read straight off a lock-screen
 * notification without opening the mail at all.
 */

import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";

export type MagicLinkEmail = { subject: string; text: string; html: string };

export function renderMagicLinkEmail(
  url: string,
  recipientEmail: string,
  code: string
): MagicLinkEmail {
  // Escape the recipient so a crafted address can't inject markup into the footer.
  const safeEmail = recipientEmail
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Digits only — the code is generated numeric, and this guarantees nothing else reaches markup.
  const safeCode = code.replace(/\D/g, "");
  return {
    subject: `${safeCode} is your ${PRODUCT_NAME} sign-in code`,
    text: [
      PRODUCT_NAME,
      "",
      `Your sign-in code: ${safeCode}`,
      "",
      "Type it into the tab where you asked to sign in. Expires in 15 minutes.",
      "",
      "Or open this link to sign in on this device:",
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
      <tr><td style="padding:0 4px 16px;">
        <p style="margin:0;font-size:15px;line-height:1.55;color:#D9D4CA;">Type this code into the tab where you asked to sign in.</p>
      </td></tr>
      <!-- The code block. Letter-spaced and oversized so it reads in one glance from a
           notification shade; the app's own typeface is never available in an inbox, so this
           rides the same system stack as the rest of the email. -->
      <tr><td style="padding:0 4px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:12px;border:1px solid #2B2A27;background:#1A1917;text-align:center;padding:20px 12px;">
            <span style="font-size:34px;font-weight:700;letter-spacing:0.22em;color:#FFD60A;">${safeCode}</span>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 4px 26px;">
        <p style="margin:0;font-size:12px;color:#7D786E;">Expires in 15 minutes. Works once.</p>
      </td></tr>
      <tr><td style="padding:0 4px 12px;">
        <p style="margin:0;font-size:12px;color:#7D786E;">Reading this on the same device you signed in from? Tap instead:</p>
      </td></tr>
      <tr><td style="padding:0 4px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:10px;border:1px solid #3A3833;text-align:center;">
            <a href="${url}" style="display:block;padding:13px 24px;font-size:14px;font-weight:600;color:#D9D4CA;text-decoration:none;">Sign in on this device</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:14px 4px 0;border-top:1px solid #2B2A27;">
        <p style="margin:0;font-size:11.5px;line-height:1.7;color:#7D786E;">Requested for ${safeEmail} &mdash; not you? Ignore this.<br>${PRODUCT_NAME} &middot; ${BRAND_DOMAIN}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  };
}
