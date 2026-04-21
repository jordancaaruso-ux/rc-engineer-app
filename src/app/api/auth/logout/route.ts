import { signOut } from "@/auth";

/** Convenience redirect — same as Auth.js `/api/auth/signout`. */
export async function GET() {
  return signOut({ redirectTo: "/login" });
}
