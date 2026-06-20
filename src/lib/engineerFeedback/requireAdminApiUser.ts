import "server-only";

import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";

type AdminUser = NonNullable<Awaited<ReturnType<typeof getAuthenticatedApiUser>>>;

export type AdminApiAuth =
  | { ok: true; user: AdminUser }
  | { ok: false; response: NextResponse };

export async function requireAdminApiUser(): Promise<AdminApiAuth> {
  const user = await getAuthenticatedApiUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isAuthAdminEmail(user.email)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, user };
}
