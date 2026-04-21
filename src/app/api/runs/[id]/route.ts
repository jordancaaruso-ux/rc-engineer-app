import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

/**
 * Delete a run owned by the current user.
 *
 * Related rows:
 *  - `RunImportedLapSet` (+ laps) cascade automatically.
 *  - `ActionItem.sourceRunId` is set null (schema SetNull).
 *  - `ImportedLapTimeSession.linkedRunId` / `Run.importedLapTimeSessionId`
 *    are set null (schema SetNull).
 *  - `SetupSnapshot` is intentionally NOT deleted — other runs (and the
 *    setup history) may still reference it.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const existing = await prisma.run.findFirst({
    where: { id, userId: user.id },
    select: { id: true, eventId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  await prisma.run.delete({ where: { id: existing.id } });

  revalidatePath("/runs/history");
  revalidatePath("/");
  revalidatePath("/engineer");
  revalidatePath("/laps/import");

  return NextResponse.json({ ok: true });
}
