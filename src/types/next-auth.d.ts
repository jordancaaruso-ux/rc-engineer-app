import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** True only for the shared read-only demo account (MONETISATION_NORTH_STAR.md Phase 3). */
      isDemo?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    /** Demo-account stamp — set in auth.config's jwt callback, read by the edge middleware. */
    isDemo?: boolean;
  }
}
