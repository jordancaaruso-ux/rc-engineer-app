import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { createTransport } from "nodemailer";
import authConfig from "@/auth.config";
import { DEV_EMAIL_FROM } from "@/lib/brand/brandNames";
import { prisma } from "@/lib/prisma";
import { isEmailAuthAllowed } from "@/lib/authAllowlist";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";
import { renderMagicLinkEmail } from "@/lib/auth/magicLinkEmail";

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
      from: process.env.EMAIL_FROM?.trim() || DEV_EMAIL_FROM,
      async sendVerificationRequest(params) {
        const { identifier, url, provider } = params;
        if (!(await isEmailAuthAllowed(identifier))) {
          return;
        }
        if (!hasSmtpConfig) {
          console.info(`[auth] Magic link for ${identifier}:\n${url}\n`);
          return;
        }
        const transport = createTransport(provider.server);
        // Rendered in `lib/auth/magicLinkEmail.ts`, shared with the paid-signup webhook send.
        const email = renderMagicLinkEmail(url, identifier);
        const result = await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: email.subject,
          text: email.text,
          html: email.html,
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
      // Reconcile the avatar (`picture`) against the DB (source of truth) whenever the
      // token carries a falsy value — Node-only (Prisma); the edge middleware uses the
      // leaner auth.config jwt and doesn't need the avatar. This covers:
      //   1. `picture === undefined` — legacy tokens minted before the feature.
      //   2. Fresh sign-in with a falsy `picture` — Auth.js does NOT reliably copy
      //      the adapter user's `image` into the token for the Email (magic-link)
      //      provider, so `auth.config` seeds `picture = user.image ?? null` and
      //      lands on `null` even when the DB has an avatar.
      //   3. `picture === null` on a steady-state request after an upload — an
      //      installed iOS standalone PWA doesn't durably persist the `Set-Cookie`
      //      that `useSession().update({ image })` issues, so a cold start reads a
      //      session cookie still seeded `null` from sign-in. The avatar showed
      //      instantly (in-memory session) then vanished on app-kill until re-upload.
      // Trade-off: avatar-less users (falsy `picture`) incur one indexed PK read per
      // JWT validation; a set avatar is a truthy URL, so steady-state skips the DB.
      const needsBackfill =
        token != null && typeof token.sub === "string" && !token.picture;
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
