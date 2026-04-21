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
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
