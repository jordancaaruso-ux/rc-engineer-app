import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Nodemailer from "next-auth/providers/nodemailer";
import { createTransport } from "nodemailer";
import authConfig from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { isEmailAuthAllowed } from "@/lib/authAllowlist";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";

const hasSmtpConfig = isMagicLinkSmtpConfigured();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Nodemailer({
      server: process.env.EMAIL_SERVER?.trim() || { jsonTransport: true },
      from: process.env.EMAIL_FROM?.trim() || "RC Engineer <dev@localhost>",
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
          text: `Sign in to RC Engineer\n${url}\n`,
          html: `<p>Sign in to <strong>RC Engineer</strong> (${host})</p><p><a href="${url}">Click here to continue</a></p>`,
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
