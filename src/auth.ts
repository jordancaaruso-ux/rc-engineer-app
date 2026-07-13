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
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      // Backfill the avatar (`picture`) from the DB in two cases, both Node-only
      // (Prisma); the edge middleware uses the leaner auth.config jwt and doesn't
      // need the avatar:
      //   1. `picture === undefined` — legacy tokens minted before the feature.
      //   2. Fresh sign-in with a falsy `picture` — Auth.js does NOT reliably copy
      //      the adapter user's `image` into the token for the Email (magic-link)
      //      provider, so `auth.config` seeds `picture = user.image ?? null` and
      //      lands on `null` even when the DB has an avatar. That hid the avatar
      //      after every re-login until the user re-uploaded (recurring bug).
      // Steady-state requests (no `user`, defined `picture`) never touch the DB.
      const isSignIn = Boolean(params.user);
      const needsBackfill =
        token != null &&
        typeof token.sub === "string" &&
        (token.picture === undefined || (isSignIn && !token.picture));
      if (needsBackfill) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token!.sub as string },
          select: { image: true },
        });
        token!.picture = dbUser?.image ?? null;
      }
      return token;
    },
    async signIn({ user }) {
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;
      return isEmailAuthAllowed(email);
    },
  },
});
