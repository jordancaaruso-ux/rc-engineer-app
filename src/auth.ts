import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { createTransport } from "nodemailer";
import authConfig from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { isEmailAuthAllowed } from "@/lib/authAllowlist";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";

const hasSmtpConfig = isMagicLinkSmtpConfigured();
const googleId = process.env.AUTH_GOOGLE_ID?.trim();
const googleSecret = process.env.AUTH_GOOGLE_SECRET?.trim();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(googleId && googleSecret
      ? [
          Google({
            clientId: googleId,
            clientSecret: googleSecret,
            /** Same person may switch between Google and magic link when emails match. */
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    Nodemailer({
      server: process.env.EMAIL_SERVER?.trim() || { jsonTransport: true },
      from: process.env.EMAIL_FROM?.trim() || "JRC Race Engineer <dev@localhost>",
      async sendVerificationRequest(params) {
        const { identifier, url, provider } = params;
        if (!(await isEmailAuthAllowed(identifier))) {
          return;
        }
        if (!hasSmtpConfig) {
          console.info(`[auth] Magic link for ${identifier}:\n${url}\n`);
          return;
        }
        const { host } = new URL(url);
        const transport = createTransport(provider.server);
        const result = await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: `Sign in to ${host}`,
          text: `Sign in to JRC Race Engineer\n${url}\n`,
          html: `<p>Sign in to <strong>JRC Race Engineer</strong> (${host})</p><p><a href="${url}">Click here to continue</a></p>`,
        });
        const rejected = result.rejected || [];
        const pending = result.pending || [];
        const failed = rejected.concat(pending).filter(Boolean);
        if (failed.length) {
          throw new Error(`Email (${failed.join(", ")}) could not be sent`);
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;
      return isEmailAuthAllowed(email);
    },
  },
});
