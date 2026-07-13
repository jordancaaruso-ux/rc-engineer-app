import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config (no Prisma, Nodemailer, or Node `stream`).
 * Used by `middleware.ts`. Full providers + adapter live in `auth.ts`.
 */
const authConfig = {
  trustHost: true,
  /** Required for JWT + Edge middleware; env inference can fail on Edge without this line. */
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/verify-request",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user?.id) {
        token.sub = user.id;
        // Seed the avatar from the DB/provider user on sign-in — Auth.js core doesn't
        // reliably copy the adapter user's `image` into `token.picture` for the Email
        // provider, so a freshly-minted token would otherwise render a blank avatar in
        // `AccountMenu` (which reads `session.user.image`) even though Settings, which
        // reads `user.image` from the DB, still shows it. Uploads mirror via `update` below.
        token.picture = user.image ?? null;
      }
      // Profile-picture uploads call `useSession().update({ image })`; sessions are JWT,
      // so mirror the new value into `token.picture` here — otherwise the avatar stays
      // stale until the 30-day token is re-minted at next sign-in.
      if (trigger === "update" && session && typeof session === "object" && "image" in session) {
        token.picture = (session as { image?: string | null }).image ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      if (session.user && token.picture !== undefined) {
        session.user.image = token.picture as string | null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
