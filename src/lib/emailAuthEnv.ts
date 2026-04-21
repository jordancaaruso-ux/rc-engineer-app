/** True when Nodemailer can send real messages (magic link to inbox). */
export function isMagicLinkSmtpConfigured(): boolean {
  return Boolean(process.env.EMAIL_SERVER?.trim()) && Boolean(process.env.EMAIL_FROM?.trim());
}
