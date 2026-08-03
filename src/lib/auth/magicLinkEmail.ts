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
    subject: `Your sign-in link for ${PRODUCT_NAME}`,
    text: [
      `Sign in to ${PRODUCT_NAME}`,
      "",
      "Use the link below to sign in. It works once and expires shortly.",
      "",
      url,
      "",
      "If you didn't request this, you can safely ignore this email.",
    ].join("\n"),
    // Table-based, inline-styled HTML so it holds up in Outlook and the rest. Text wordmark
    // (no images) so it renders even when a client blocks images by default.
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:#EDEFF2;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="background:#16181D;padding:22px 28px 19px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:12px;vertical-align:middle;">
            <div style="width:36px;height:36px;border-radius:9px;background:#FFD60A;color:#14161A;font-weight:800;font-size:13px;text-align:center;line-height:36px;">JRC</div>
          </td>
          <td style="vertical-align:middle;">
            <div style="color:#ffffff;font-weight:600;font-size:15px;line-height:1.15;">${PRODUCT_NAME}</div>
            <div style="color:#FFD60A;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;padding-top:4px;">${BRAND_DOMAIN}</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="height:4px;line-height:4px;font-size:0;background:#FFD60A;">&nbsp;</td></tr>
      <tr><td style="padding:28px 28px 6px;">
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8A9199;padding-bottom:11px;">Secure sign-in</div>
        <h1 style="margin:0 0 12px;font-size:21px;font-weight:600;color:#14161A;">Sign in to ${PRODUCT_NAME}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#464C54;">Tap the button below to sign in. For your security, this link works once and expires shortly.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:2px 0 20px;"><tr>
          <td style="border-radius:9px;background:#FFD60A;">
            <a href="${url}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#14161A;text-decoration:none;">Sign in</a>
          </td>
        </tr></table>
        <p style="margin:0 0 8px;font-size:12px;color:#8A9199;">Button not working? Paste this link into your browser:</p>
        <p style="margin:0 0 22px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;color:#5F6670;word-break:break-all;background:#F5F6F7;border:1px solid #ECEDEF;border-radius:7px;padding:10px 12px;"><a href="${url}" style="color:#5F6670;text-decoration:none;">${url}</a></p>
      </td></tr>
      <tr><td style="background:#F7F8F9;padding:18px 28px 22px;border-top:1px solid #ECEDEF;">
        <p style="margin:0 0 5px;font-size:11.5px;line-height:1.6;color:#8A9199;">You&#39;re receiving this because a sign-in was requested for ${safeEmail} at ${PRODUCT_NAME}. If that wasn&#39;t you, no action is needed &mdash; the link only works from this inbox and expires on its own.</p>
        <p style="margin:0;font-size:11.5px;line-height:1.6;color:#6B7280;font-weight:600;">${PRODUCT_NAME} &middot; ${BRAND_DOMAIN}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  };
}
