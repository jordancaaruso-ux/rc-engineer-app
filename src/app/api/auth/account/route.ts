import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { collectUserBlobUrls, deleteBlobUrls } from "@/lib/account/deleteAccountBlobs";
import { DEMO_READ_ONLY_MESSAGE, isDemoIdentity } from "@/lib/demo/demoAccess";

/**
 * GDPR / App Store: delete the signed-in user and all owned data (DB cascades), plus the files
 * they uploaded. Client should call `signOut({ callbackUrl: "/login" })` after a successful
 * response.
 */
export async function DELETE() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // /api/auth/* is excluded from the middleware matcher, so the central demo read-only guard
  // never sees this route — and this is the one click that would destroy the whole curated
  // demo dataset. Guard it explicitly (MONETISATION_NORTH_STAR.md Phase 3).
  if (isDemoIdentity({ id, email: session?.user?.email })) {
    return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE, demo: true }, { status: 403 });
  }

  // Read the file refs first — the cascade below destroys the rows that point at them.
  const blobUrls = await collectUserBlobUrls(id);

  await prisma.user.delete({ where: { id } });

  // After the DB delete, so a blob-storage outage can't block someone deleting their account.
  const blobs = await deleteBlobUrls(blobUrls);
  if (blobs.failed > 0) {
    console.error(`[account-delete] user=${id} left ${blobs.failed} orphaned blob(s)`);
  }

  return NextResponse.json({ ok: true });
}
