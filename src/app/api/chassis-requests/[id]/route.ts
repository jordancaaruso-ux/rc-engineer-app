import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { resolveChassisTypeRequest } from "@/lib/setupSheetModels/chassisTypeRequests";

/** Admin dismisses a chassis-type request from the review queue (marks it resolved). */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  await resolveChassisTypeRequest(id);
  return NextResponse.json({ ok: true });
}
